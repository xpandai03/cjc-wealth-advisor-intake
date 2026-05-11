// One-time seeder for the v1 RuleSet. Idempotent — re-running is a no-op
// once a published row exists.
//
// Run with:
//   DATABASE_URL=postgres://... pnpm --filter @workspace/scripts seed-rule-set-v1
//
// The v1 RuleSet definition lives in lib/scoring/src/v1-rule-set.ts. This
// script reads V1_RULE_SET, validates it through the compiler, and inserts
// it at status="published" version=1. If a published row already exists,
// the script reports and exits without inserting.

import {
  V1_RULE_SET,
  V1_RULE_SET_NAME,
  compileRuleSet,
} from "@workspace/scoring";
import { db, eq, pool, scoringRuleSets } from "@workspace/db";

const SEED_ACTOR = "system:sprint-2-seed";

async function main() {
  // 1. Validate the source-of-truth RuleSet through the Zod compiler so
  //    any drift in the type model is caught before we hit the DB.
  const ruleSet = compileRuleSet(V1_RULE_SET);
  console.log(`Validated V1 RuleSet: ${ruleSet.rules.length} rules + default.`);

  // 2. Check whether a published rule set already exists. The unique
  //    partial index `scoring_rule_sets_one_published` would catch a
  //    double-insert at the DB level, but the explicit check produces
  //    a clean exit + message rather than a constraint error.
  const existing = await db
    .select({
      id: scoringRuleSets.id,
      version: scoringRuleSets.version,
      name: scoringRuleSets.name,
      createdAt: scoringRuleSets.createdAt,
    })
    .from(scoringRuleSets)
    .where(eq(scoringRuleSets.status, "published"))
    .limit(1);

  if (existing.length > 0) {
    const row = existing[0];
    console.log(
      `Already seeded: published rule set v${row.version} (id=${row.id}, name=${JSON.stringify(row.name)}, created=${row.createdAt.toISOString()}).`,
    );
    console.log("No-op. To re-seed, set the existing row to 'archived' first.");
    await pool.end();
    return;
  }

  // 3. Insert v1.
  const [inserted] = await db
    .insert(scoringRuleSets)
    .values({
      version: 1,
      name: V1_RULE_SET_NAME,
      status: "published",
      rules: ruleSet,
      createdBy: SEED_ACTOR,
      publishedAt: new Date(),
      publishedBy: SEED_ACTOR,
    })
    .returning({
      id: scoringRuleSets.id,
      version: scoringRuleSets.version,
    });

  console.log(`Inserted: v${inserted.version}, id=${inserted.id}.`);
  console.log(`Status: published. Visible to /api/submit's scoring step.`);
  await pool.end();
}

main().catch((err) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(msg);
  process.exit(1);
});
