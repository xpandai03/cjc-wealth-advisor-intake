// GET /api/rules/published — the currently published RuleSet.
//
// Auth-guarded. Returns the single row from scoring_rule_sets with
// status='published' (uniqueness is enforced by the partial unique index
// scoring_rule_sets_one_published). Returns 404 if no published row
// exists — production always has one, but the seeded-window edge case
// gets a 404 instead of a 500.

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { db, eq, scoringRuleSets } from "@workspace/db";
import { requireRole } from "../_lib/auth";

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }
  const auth = await requireRole(req, res, ["admin"]);
  if (!auth) return;

  const rows = await db
    .select({
      id: scoringRuleSets.id,
      version: scoringRuleSets.version,
      name: scoringRuleSets.name,
      rules: scoringRuleSets.rules,
      publishedBy: scoringRuleSets.publishedBy,
      publishedAt: scoringRuleSets.publishedAt,
      createdAt: scoringRuleSets.createdAt,
    })
    .from(scoringRuleSets)
    .where(eq(scoringRuleSets.status, "published"))
    .limit(1);

  const row = rows[0];
  if (!row) {
    return res.status(404).json({ error: "No published rule set" });
  }
  return res.status(200).json(row);
}
