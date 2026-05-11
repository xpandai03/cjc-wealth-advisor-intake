// Tests for /api/rules/published.
//
// Tests the auth gate and the happy path against the existing published
// row (seeded by scripts/seed-rule-set-v1). The "no published row"
// edge case is exercised by temporarily flipping the published row to
// status='archived' and restoring it after — wrapped in a try/finally so
// a mid-test failure does not leave prod with no published rule set.

import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { db, eq, scoringRuleSets } from "@workspace/db";
import publishedHandler from "../rules/published";
import { SESSION_COOKIE_NAME } from "../_lib/auth";
import { cleanupAll, createTestUser, makeSessionFor } from "./fixtures";
import { makeReq, makeRes } from "./harness";

before(() => {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL must be set to run rules tests");
  }
});

async function authedReq(opts: Parameters<typeof makeReq>[0]) {
  const { user } = await createTestUser();
  const sessionId = await makeSessionFor(user.id);
  return makeReq({ ...opts, cookie: `${SESSION_COOKIE_NAME}=${sessionId}` });
}

after(cleanupAll);

describe("GET /api/rules/published", () => {
  it("returns 401 without a session cookie", async () => {
    const req = makeReq({ method: "GET" });
    const res = makeRes();
    await publishedHandler(req, res);
    assert.equal(res.statusCode, 401);
  });

  it("returns 405 for non-GET", async () => {
    const req = await authedReq({ method: "POST" });
    const res = makeRes();
    await publishedHandler(req, res);
    assert.equal(res.statusCode, 405);
  });

  it("returns the published RuleSet for authed users", async () => {
    const req = await authedReq({ method: "GET" });
    const res = makeRes();
    await publishedHandler(req, res);
    assert.equal(res.statusCode, 200);
    const body = res.jsonBody as {
      id: string;
      version: number;
      name: string;
      rules: unknown;
    };
    assert.ok(body.id, "id should be present");
    assert.ok(body.version >= 1, "version should be >= 1");
    assert.ok(body.rules, "rules JSON should be present");
  });

  it("returns 404 when there is no published RuleSet", async () => {
    // Find the current published row, flip it to archived for the duration
    // of the assertion, then restore. try/finally guarantees restoration
    // even if the assertion throws.
    const rows = await db
      .select({ id: scoringRuleSets.id })
      .from(scoringRuleSets)
      .where(eq(scoringRuleSets.status, "published"));
    const publishedId = rows[0]?.id;
    if (!publishedId) {
      // Already in the "no published row" state; just assert and exit.
      const req = await authedReq({ method: "GET" });
      const res = makeRes();
      await publishedHandler(req, res);
      assert.equal(res.statusCode, 404);
      return;
    }
    try {
      await db
        .update(scoringRuleSets)
        .set({ status: "archived" })
        .where(eq(scoringRuleSets.id, publishedId));
      const req = await authedReq({ method: "GET" });
      const res = makeRes();
      await publishedHandler(req, res);
      assert.equal(res.statusCode, 404);
    } finally {
      await db
        .update(scoringRuleSets)
        .set({ status: "published" })
        .where(eq(scoringRuleSets.id, publishedId));
    }
  });
});
