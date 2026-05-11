import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
// Star-import all schema files into a single namespace so Drizzle's
// query-builder can resolve every table. Re-export each file explicitly
// below so consumers can `import { users, sessions, ... } from "@workspace/db"`.
import * as authSchema from "./schema/auth";
import * as linksSchema from "./schema/links";
import * as scoringSchema from "./schema/scoring";
import * as settingsSchema from "./schema/settings";
import * as submissionsSchema from "./schema/submissions";

const schema = {
  ...authSchema,
  ...linksSchema,
  ...scoringSchema,
  ...settingsSchema,
  ...submissionsSchema,
};

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

export const pool = new Pool({ connectionString: process.env.DATABASE_URL });
export const db = drizzle(pool, { schema });

// Re-export the schema files directly (file-path imports, not directory-index).
// We went through ./schema/index.ts originally, but Vercel's function-compile
// pass didn't follow the directory-resolution + re-export chain reliably
// (exports defined inline here worked; exports reached via export * from "./schema"
// did not). File-path re-exports bypass the directory resolution entirely.
export * from "./schema/auth";
export * from "./schema/links";
export * from "./schema/scoring";
export * from "./schema/settings";
export * from "./schema/submissions";

// Re-export the drizzle query-builder helpers we use across the app.
// API code (Intake-form/api/*) imports these from @workspace/db so there's
// only ONE drizzle-orm module identity in the type graph — avoids pnpm's
// nested-install "type X is not assignable to type X" identity issues when
// drizzle-orm is referenced from two different node_modules paths.
export {
  and,
  count,
  eq,
  gt,
  gte,
  inArray,
  lt,
  lte,
  not,
  or,
  sql,
} from "drizzle-orm";
