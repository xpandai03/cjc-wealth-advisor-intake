import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

export const pool = new Pool({ connectionString: process.env.DATABASE_URL });
export const db = drizzle(pool, { schema });

export * from "./schema";

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
