// GET /api/submissions/[id] — full detail for a single submission.
//
// Auth-guarded. Returns every column on the row including the heavy
// raw_payload and scoring_trace blobs, plus a LEFT JOIN against
// scoring_rule_sets so the UI can show "Scored by RuleSet v3: <name>"
// without a second round-trip.
//
// 404 when the id doesn't match a submission. 400 when the id isn't a
// valid UUID — keeps the DB from running a useless cast.

import type { VercelRequest, VercelResponse } from "@vercel/node";
import {
  db,
  eq,
  scoringRuleSets,
  submissions,
} from "@workspace/db";
import { requireRole } from "../_lib/auth";

const UUID_PATTERN =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

function firstOf(value: unknown): string | undefined {
  if (Array.isArray(value)) return value[0] as string | undefined;
  if (typeof value === "string") return value;
  return undefined;
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }
  const auth = await requireRole(req, res, ["admin", "marketing"]);
  if (!auth) return;

  const id = firstOf(req.query.id);
  if (!id || !UUID_PATTERN.test(id)) {
    return res.status(400).json({ error: "Invalid submission id" });
  }

  const rows = await db
    .select({
      submission: submissions,
      ruleSetVersion: scoringRuleSets.version,
      ruleSetName: scoringRuleSets.name,
    })
    .from(submissions)
    .leftJoin(
      scoringRuleSets,
      eq(submissions.scoringRuleSetId, scoringRuleSets.id),
    )
    .where(eq(submissions.id, id))
    .limit(1);

  const row = rows[0];
  if (!row) {
    return res.status(404).json({ error: "Submission not found" });
  }

  return res.status(200).json({
    submission: row.submission,
    ruleSet: row.submission.scoringRuleSetId
      ? {
          id: row.submission.scoringRuleSetId,
          version: row.ruleSetVersion,
          name: row.ruleSetName,
        }
      : null,
  });
}
