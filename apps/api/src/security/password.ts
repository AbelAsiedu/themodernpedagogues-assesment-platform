import { hash, verify } from "@node-rs/argon2";

// Argon2id with OWASP-recommended minimums (19 MiB, t=2, p=1).
const OPTIONS = { memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

export function hashPassword(plain: string): Promise<string> {
  return hash(plain, OPTIONS);
}

export async function verifyPassword(hashed: string, plain: string): Promise<boolean> {
  try {
    return await verify(hashed, plain);
  } catch {
    return false;
  }
}

let dummy: Promise<string> | undefined;
/**
 * Verify against a throwaway hash when the account does not exist so that
 * "unknown email" and "wrong password" cost the same time (no user enumeration by timing).
 */
export async function burnPasswordCheck(plain: string): Promise<void> {
  dummy ??= hashPassword("tmp-dummy-password-for-timing");
  await verifyPassword(await dummy, plain);
}
