import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import type { Redis } from "ioredis";
import { can, type Actor, type Scope } from "./authz/can.js";
import type { Permission } from "@tmp/shared";
import type { Config } from "./config.js";
import type { Db, Sql } from "./db/client.js";
import { HttpError, forbidden, unauthorized } from "./errors.js";
import { audit } from "./audit.js";
import { loadActor } from "./session.js";
import { authRoutes } from "./routes/auth.js";
import { userRoutes } from "./routes/users.js";
import { institutionRoutes } from "./routes/institutions.js";
import { classRoutes } from "./routes/classes.js";
import { adminRoutes } from "./routes/admin.js";
import { questionRoutes } from "./routes/questions.js";
import { aiRoutes } from "./routes/ai.js";
import { quizRoutes } from "./routes/quizzes.js";
import { playRoutes } from "./routes/play.js";
import { liveRoutes } from "./routes/live.js";
import websocket from "@fastify/websocket";
import { Leaderboard } from "./quiz/leaderboard.js";
import { LiveHub } from "./quiz/hub.js";
import type { AiProvider } from "./ai/provider.js";

export interface AppDeps {
  config: Config;
  db: Db;
  sql: Sql;
  redis?: Redis;
  /** Undefined when no AI provider is configured. */
  ai?: AiProvider;
}

declare module "fastify" {
  interface FastifyRequest {
    actor?: Actor;
    sessionToken?: string;
  }
  interface FastifyInstance {
    deps: AppDeps;
    leaderboard: Leaderboard;
    hub: LiveHub;
    /** Resolve the signed-in actor or throw 401. */
    requireActor(req: FastifyRequest): Actor;
    /** Throw 403 (and write a denied audit record) unless the actor holds the permission in scope. */
    authorize(req: FastifyRequest, permission: Permission, scope?: Scope): Actor;
  }
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const { config, db } = deps;
  const app = Fastify({
    logger: config.NODE_ENV === "test" ? false : { level: "info", redact: ["req.headers.cookie", "req.headers.authorization"] },
    trustProxy: true,
    bodyLimit: 1_048_576,
  });
  app.decorate("deps", deps);
  const leaderboard = new Leaderboard(db, deps.redis);
  const hub = new LiveHub(db, leaderboard, deps.redis);
  app.decorate("leaderboard", leaderboard);
  app.decorate("hub", hub);
  await hub.start();
  app.addHook("onClose", async () => { await hub.stop(); });

  await app.register(helmet);
  await app.register(cors, { origin: config.webOrigins, credentials: true });
  await app.register(cookie);
  await app.register(websocket, { options: { maxPayload: 1024 } });
  await app.register(rateLimit, {
    global: true,
    // Count per signed-in user, not per IP: a whole classroom shares one school IP address, and must not throttle itself.
    hook: "preHandler",
    keyGenerator: (req) => req.actor?.id ?? req.ip,
    max: config.RATE_LIMIT_MAX,
    timeWindow: "1 minute",
    ...(deps.redis ? { redis: deps.redis } : {}),
  });

  // Resolve the session for every request (cheap no-op when there is no cookie).
  app.addHook("onRequest", async (req) => {
    const token = req.cookies[config.SESSION_COOKIE_NAME];
    if (!token) return;
    req.sessionToken = token;
    const actor = await loadActor(db, token);
    if (actor) req.actor = actor;
  });

  // CSRF defence for cookie-authenticated mutations: the request must come from our web origin.
  // (SameSite=Lax cookies are the first layer; this is the second.)
  app.addHook("preHandler", async (req) => {
    if (SAFE_METHODS.has(req.method) || !req.sessionToken) return;
    const origin = req.headers.origin;
    if (origin) {
      if (!config.webOrigins.includes(origin)) throw forbidden("Cross-origin request blocked");
    } else if (req.headers["x-tmp-client"] !== "web") {
      throw forbidden("Missing origin");
    }
  });

  app.decorate("requireActor", (req: FastifyRequest) => {
    if (!req.actor) throw unauthorized();
    return req.actor;
  });

  app.decorate("authorize", function (this: FastifyInstance, req: FastifyRequest, permission: Permission, scope: Scope = {}) {
    const actor = this.requireActor(req);
    if (!can(actor, permission, scope)) {
      // Fire-and-forget: a denial must not depend on the audit write succeeding.
      void audit(
        db,
        {
          action: "authz.denied",
          actorUserId: actor.id,
          institutionId: scope.institutionId ?? null,
          outcome: "denied",
          ip: req.ip,
          metadata: { permission, method: req.method, url: req.url.split("?")[0] },
        },
        { log: (m) => req.log.error(m) },
      );
      throw forbidden();
    }
    return actor;
  });

  app.setErrorHandler((err: Error & { statusCode?: number; code?: string }, req, reply) => {
    if (err instanceof HttpError) {
      return reply.status(err.statusCode).send({ error: { code: err.code, message: err.message, details: err.details } });
    }
    if (err.statusCode && err.statusCode < 500) {
      return reply.status(err.statusCode).send({ error: { code: err.code ?? "request_error", message: err.message } });
    }
    req.log.error({ err }, "unhandled error");
    // Never leak internals to the client.
    return reply.status(500).send({ error: { code: "internal_error", message: "Something went wrong" } });
  });

  app.setNotFoundHandler((_req, reply) => reply.status(404).send({ error: { code: "not_found", message: "Not found" } }));

  app.get("/health", async () => ({ status: "ok" }));
  app.get("/health/ready", async (_req, reply) => {
    try {
      await deps.sql`select 1`;
      return { status: "ready", database: "ok" };
    } catch {
      return reply.status(503).send({ status: "unavailable", database: "down" });
    }
  });

  await app.register(
    async (v1) => {
      await v1.register(authRoutes);
      await v1.register(userRoutes);
      await v1.register(institutionRoutes);
      await v1.register(classRoutes);
      await v1.register(adminRoutes);
      await v1.register(questionRoutes);
      await v1.register(aiRoutes);
      await v1.register(quizRoutes);
      await v1.register(playRoutes);
      await v1.register(liveRoutes);
    },
    { prefix: "/api/v1" },
  );

  return app;
}
