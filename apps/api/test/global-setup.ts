import postgres from "postgres";
import { runMigrations } from "../src/db/migrate.js";

export const TEST_DB_URL =
  process.env.TEST_DATABASE_URL ?? "postgres://tmp:tmp_dev_password@localhost:5432/tmp_assessment_test";

/** Rebuild the test database from scratch via the real migrations, so tests exercise the real schema + triggers. */
export default async function setup() {
  if (!/test/.test(new URL(TEST_DB_URL).pathname)) {
    throw new Error("Refusing to reset a database whose name does not contain 'test'");
  }
  const sql = postgres(TEST_DB_URL, { max: 1, onnotice: () => {} });
  try {
    await sql.unsafe("DROP SCHEMA IF EXISTS public CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE; CREATE SCHEMA public;");
  } finally {
    await sql.end();
  }
  await runMigrations(TEST_DB_URL);
}
