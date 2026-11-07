import { createHash, randomBytes } from "node:crypto";

/** 256-bit random session token handed to the browser. */
export function newSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

/** Only this hash is stored, so a database leak does not yield usable sessions. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
