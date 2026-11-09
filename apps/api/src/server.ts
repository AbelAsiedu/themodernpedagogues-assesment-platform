import { Redis } from "ioredis";
import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createDb } from "./db/client.js";
import { OpenAiProvider } from "./ai/openai.js";

const config = loadConfig();
const { db, sql } = createDb(config.DATABASE_URL);
const redis = config.REDIS_URL ? new Redis(config.REDIS_URL, { maxRetriesPerRequest: 2, lazyConnect: false }) : undefined;
redis?.on("error", (e) => console.error("redis error:", e.message));

const ai =
  config.AI_PROVIDER === "openai" && config.AI_API_KEY
    ? new OpenAiProvider({ apiKey: config.AI_API_KEY, model: config.AI_MODEL, baseUrl: config.AI_BASE_URL, timeoutMs: config.AI_TIMEOUT_MS })
    : undefined;
if (config.AI_PROVIDER !== "none" && !ai) console.warn("AI_PROVIDER is set but AI_API_KEY is missing: AI features are disabled.");

const app = await buildApp({ config, db, sql, redis, ai });

const shutdown = async (signal: string) => {
  app.log.info(`${signal} received, shutting down`);
  await app.close();
  await sql.end({ timeout: 5 });
  redis?.disconnect();
  process.exit(0);
};
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

await app.listen({ port: config.PORT, host: "0.0.0.0" });
