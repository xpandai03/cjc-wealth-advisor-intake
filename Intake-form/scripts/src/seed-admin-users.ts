// Seed the `users` table with three admin accounts. One-time script.
// Idempotent: if a user with the same email already exists, skip with a
// notice — DO NOT overwrite the existing password hash.
//
// Passwords MUST be supplied via env vars, not CLI args (CLI args leak to
// shell history). The script never logs passwords; it only logs which
// emails were processed.
//
// Usage:
//   DATABASE_URL=postgres://... \
//   ADMIN_1_EMAIL=raunek@xpandai.com ADMIN_1_PASSWORD='...' ADMIN_1_NAME='Raunek Pratap' \
//   pnpm --filter @workspace/scripts seed-admin-users
//
// Optional per-slot ADMIN_N_ROLE — 'admin' (default) or 'marketing'. A
// 'marketing' user sees only the Links, Submissions, and Activity tabs.
// Example — seed a limited-access marketing user:
//   DATABASE_URL=postgres://... \
//   ADMIN_1_EMAIL=hanzala@example.com ADMIN_1_PASSWORD='...' \
//   ADMIN_1_NAME='Muhammad Hanzala' ADMIN_1_ROLE='marketing' \
//   pnpm --filter @workspace/scripts seed-admin-users
//
// Run with only the admins you want to seed — missing ADMIN_N_* trios are
// skipped silently. To rotate a password, delete the user row in SQL first
// then re-run this script (no overwrite by design).

import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { db, pool, users } from "@workspace/db";

const BCRYPT_COST = 10;

type Role = "admin" | "marketing";
type AdminSpec = {
  email: string;
  password: string;
  name: string;
  role: Role;
  slot: number;
};

// ADMIN_N_ROLE is optional; absent/empty → 'admin'. Any other value is a
// hard error so a typo can never silently grant the wrong access level.
// Mirrors parseRole() in api/_lib/roles.ts (kept inline — the scripts
// package can't import from the api function tree).
function readRole(slot: number): Role {
  const raw = process.env[`ADMIN_${slot}_ROLE`];
  if (raw == null || raw.trim() === "") return "admin";
  const v = raw.trim().toLowerCase();
  if (v === "admin" || v === "marketing") return v;
  throw new Error(
    `ADMIN_${slot}_ROLE invalid ("${raw}"). Use 'admin' or 'marketing'.`,
  );
}

function readAdminFromEnv(slot: number): AdminSpec | null {
  const email = process.env[`ADMIN_${slot}_EMAIL`];
  const password = process.env[`ADMIN_${slot}_PASSWORD`];
  const name = process.env[`ADMIN_${slot}_NAME`];
  if (!email && !password && !name) return null;
  if (!email || !password || !name) {
    throw new Error(
      `ADMIN_${slot}_*: must supply EMAIL + PASSWORD + NAME together (got email=${!!email}, password=${!!password}, name=${!!name})`,
    );
  }
  if (password.length < 12) {
    throw new Error(
      `ADMIN_${slot}_PASSWORD too short (${password.length} chars). Use 12+ chars; do NOT log this value.`,
    );
  }
  return {
    email: email.trim().toLowerCase(),
    password,
    name: name.trim(),
    role: readRole(slot),
    slot,
  };
}

async function main() {
  const specs: AdminSpec[] = [];
  for (const slot of [1, 2, 3]) {
    const spec = readAdminFromEnv(slot);
    if (spec) specs.push(spec);
  }

  if (specs.length === 0) {
    console.error(
      "No ADMIN_*_EMAIL / ADMIN_*_PASSWORD / ADMIN_*_NAME env vars set. Nothing to seed.",
    );
    process.exit(1);
  }

  console.log(`Seeding ${specs.length} admin user(s)…`);
  let inserted = 0;
  let skipped = 0;
  for (const spec of specs) {
    const existing = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, spec.email))
      .limit(1);
    if (existing.length > 0) {
      console.log(`  [${spec.slot}] ${spec.email}: already exists, skipped (password unchanged)`);
      skipped++;
      continue;
    }
    const passwordHash = await bcrypt.hash(spec.password, BCRYPT_COST);
    await db
      .insert(users)
      .values({
        email: spec.email,
        name: spec.name,
        passwordHash,
        role: spec.role,
      });
    console.log(
      `  [${spec.slot}] ${spec.email}: inserted (name=${JSON.stringify(spec.name)}, role=${spec.role})`,
    );
    inserted++;
  }

  console.log(`\nDone. Inserted: ${inserted}, Skipped: ${skipped}.`);
  await pool.end();
}

main().catch((err) => {
  // Never echo the password if an error spilled it into the message.
  // bcrypt errors carry the input hash, not the plaintext, so this is mainly
  // defense-in-depth.
  const msg = err instanceof Error ? err.message : String(err);
  console.error(msg);
  process.exit(1);
});
