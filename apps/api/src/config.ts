import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().default(4000),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().optional(),
  WEB_ORIGINS: z.string().default("http://localhost:3000"),
  SESSION_COOKIE_NAME: z.string().default("tmp_session"),
  SESSION_COOKIE_DOMAIN: z.string().optional(),
  SESSION_TTL_HOURS: z.coerce.number().positive().default(12),
  SEED_PASSWORD: z.string().optional(),
  // AI. Backend-only. With no key configured the AI endpoints answer 503 and the rest of the app is unaffected.
  AI_PROVIDER: z.enum(["none", "openai"]).default("none"),
  AI_API_KEY: z.string().optional(),
  AI_MODEL: z.string().default("gpt-4o-mini"),
  AI_BASE_URL: z.string().url().optional(),
  AI_TIMEOUT_MS: z.coerce.number().int().positive().default(60_000),
  AI_RATE_LIMIT_PER_MIN: z.coerce.number().int().positive().default(10),
  AI_DAILY_LIMIT_PER_USER: z.coerce.number().int().positive().default(30),
  // Per-IP limits. Defaults are production-safe; tests raise them to avoid throttling themselves.
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(300),
  LOGIN_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(20),
});

export type Config = z.infer<typeof schema> & { webOrigins: string[]; isProd: boolean };

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid environment configuration: ${issues}`);
  }
  const c = parsed.data;
  return {
    ...c,
    SESSION_COOKIE_DOMAIN: c.SESSION_COOKIE_DOMAIN || undefined,
    AI_API_KEY: c.AI_API_KEY || undefined,
    AI_BASE_URL: c.AI_BASE_URL || undefined,
    webOrigins: c.WEB_ORIGINS.split(",").map((s) => s.trim()).filter(Boolean),
    isProd: c.NODE_ENV === "production",
  };
}
