import type { Db } from "./db/client.js";
import { auditLogs } from "./db/schema.js";

export interface AuditEvent {
  action: string;
  actorUserId?: string | null;
  institutionId?: string | null;
  targetType?: string;
  targetId?: string;
  outcome?: "success" | "denied" | "failure";
  ip?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Writes an audit record. Audit failures must never be silent, but they also must not
 * mask the original response, so they are logged loudly and swallowed for non-critical events.
 * Pass `{ strict: true }` for security-critical writes (they then propagate).
 */
export async function audit(db: Db, ev: AuditEvent, opts: { strict?: boolean; log?: (m: string) => void } = {}) {
  try {
    await db.insert(auditLogs).values({
      action: ev.action,
      actorUserId: ev.actorUserId ?? null,
      institutionId: ev.institutionId ?? null,
      targetType: ev.targetType,
      targetId: ev.targetId,
      outcome: ev.outcome ?? "success",
      ip: ev.ip,
      metadata: ev.metadata ?? {},
    });
  } catch (err) {
    opts.log?.(`AUDIT WRITE FAILED for ${ev.action}: ${(err as Error).message}`);
    if (opts.strict) throw err;
  }
}
