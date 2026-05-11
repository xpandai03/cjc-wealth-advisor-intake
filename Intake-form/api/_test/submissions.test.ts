// Tests for /api/submissions (list), /api/submissions/[id], and
// /api/submissions/activity. Real DB hits — same convention as the
// auth/submit tests; no mocking.

import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { db, eq, inArray, submissions } from "@workspace/db";
import listHandler from "../submissions/index";
import detailHandler from "../submissions/[id]";
import activityHandler from "../submissions/activity";
import { SESSION_COOKIE_NAME } from "../_lib/auth";
import { cleanupAll, createTestUser, makeSessionFor } from "./fixtures";
import { makeReq, makeRes } from "./harness";

before(() => {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL must be set to run submissions tests");
  }
});

// ---------------------------------------------------------------------------
// Submissions fixture helpers
// ---------------------------------------------------------------------------

const createdSubmissionIds = new Set<string>();

type SeedOptions = {
  source?: "federal" | "internal" | "fnn";
  firstName?: string;
  lastName?: string;
  email?: string;
  rank?: string | null;
  sfStatus?: string;
  sfLeadId?: string | null;
  createdAt?: Date;
};

async function seedSubmission(opts: SeedOptions = {}): Promise<string> {
  const tag = `sprint3-${Math.random().toString(36).slice(2, 8)}`;
  const email = opts.email ?? `test+${tag}@xpand.test`;
  const [row] = await db
    .insert(submissions)
    .values({
      source: opts.source ?? "federal",
      surveyDetail: "DC SOFA",
      leadSource: "SOFA: Webinar",
      firstName: opts.firstName ?? "Test",
      lastName: opts.lastName ?? `User-${tag}`,
      email,
      phone: "555-0100",
      stateResidence: "VA",
      federalAgency: "Dept of Defense (DOD): Navy",
      qPreRetirement: "Yes",
      qAge: "59 1/2 or over",
      rank: opts.rank === undefined ? "A" : opts.rank,
      leadScore: "10  (over $1mm)",
      sfStatus: opts.sfStatus ?? "sent",
      sfLeadId: opts.sfLeadId === undefined ? "00Q000000000001" : opts.sfLeadId,
      scoringTrace: { steps: [], finalOutcome: { rank: "A" } },
      rawPayload: { firstName: opts.firstName ?? "Test", email },
      ...(opts.createdAt ? { createdAt: opts.createdAt } : {}),
    })
    .returning({ id: submissions.id });
  createdSubmissionIds.add(row.id);
  return row.id;
}

async function cleanupSubmissions(): Promise<void> {
  if (createdSubmissionIds.size > 0) {
    await db
      .delete(submissions)
      .where(inArray(submissions.id, Array.from(createdSubmissionIds)));
    createdSubmissionIds.clear();
  }
}

async function authedReq(opts: Parameters<typeof makeReq>[0]) {
  const { user } = await createTestUser();
  const sessionId = await makeSessionFor(user.id);
  return {
    req: makeReq({
      ...opts,
      cookie: `${SESSION_COOKIE_NAME}=${sessionId}`,
    }),
    user,
  };
}

after(async () => {
  await cleanupSubmissions();
  await cleanupAll();
});

// ---------------------------------------------------------------------------
// GET /api/submissions
// ---------------------------------------------------------------------------

describe("GET /api/submissions — list", () => {
  it("returns 401 without a session cookie", async () => {
    const req = makeReq({ method: "GET" });
    const res = makeRes();
    await listHandler(req, res);
    assert.equal(res.statusCode, 401);
  });

  it("returns 405 for non-GET", async () => {
    const { req } = await authedReq({ method: "POST" });
    const res = makeRes();
    await listHandler(req, res);
    assert.equal(res.statusCode, 405);
  });

  it("returns paginated submissions sorted newest-first", async () => {
    const idOld = await seedSubmission({
      createdAt: new Date(Date.now() - 60_000),
      firstName: "OldGuy",
    });
    const idNew = await seedSubmission({
      createdAt: new Date(),
      firstName: "NewGuy",
    });

    const { req } = await authedReq({
      method: "GET",
      query: { limit: "50" },
    });
    const res = makeRes();
    await listHandler(req, res);
    assert.equal(res.statusCode, 200);
    const body = res.jsonBody as { submissions: Array<{ id: string }>; total: number; page: number; hasMore: boolean };
    assert.ok(Array.isArray(body.submissions));
    assert.equal(body.page, 1);
    const idxNew = body.submissions.findIndex((s) => s.id === idNew);
    const idxOld = body.submissions.findIndex((s) => s.id === idOld);
    assert.ok(idxNew >= 0 && idxOld >= 0, "both seeded rows should appear");
    assert.ok(idxNew < idxOld, "newest row should come first");
  });

  it("filters by source", async () => {
    const idFnn = await seedSubmission({ source: "fnn", firstName: "FnnGuy" });
    await seedSubmission({ source: "federal", firstName: "FedGuy" });

    const { req } = await authedReq({
      method: "GET",
      query: { source: "fnn" },
    });
    const res = makeRes();
    await listHandler(req, res);
    assert.equal(res.statusCode, 200);
    const body = res.jsonBody as { submissions: Array<{ id: string; source: string }> };
    assert.ok(
      body.submissions.some((s) => s.id === idFnn),
      "fnn submission should appear",
    );
    for (const s of body.submissions) assert.equal(s.source, "fnn");
  });

  it("filters by sf_status='error' AND search narrows further", async () => {
    const tag = Math.random().toString(36).slice(2, 8);
    const targetEmail = `find-me-${tag}@xpand.test`;
    const idTarget = await seedSubmission({
      sfStatus: "error",
      email: targetEmail,
      firstName: "Searchable",
    });
    await seedSubmission({ sfStatus: "error", firstName: "DecoyError" });
    await seedSubmission({ sfStatus: "sent", email: `decoy-sent-${tag}@xpand.test` });

    const { req } = await authedReq({
      method: "GET",
      query: { sf_status: "error", search: `find-me-${tag}` },
    });
    const res = makeRes();
    await listHandler(req, res);
    assert.equal(res.statusCode, 200);
    const body = res.jsonBody as { submissions: Array<{ id: string; sfStatus: string; email: string }>; total: number };
    assert.equal(body.total, 1);
    assert.equal(body.submissions.length, 1);
    assert.equal(body.submissions[0].id, idTarget);
    assert.equal(body.submissions[0].email, targetEmail);
  });

  it("free-text search is case-insensitive across email + first_name + last_name", async () => {
    const tag = Math.random().toString(36).slice(2, 8);
    const idByEmail = await seedSubmission({
      email: `Capital-Email-${tag}@xpand.test`,
      firstName: "Foo",
      lastName: "Bar",
    });
    const idByLast = await seedSubmission({
      email: `unrelated-${tag}@xpand.test`,
      firstName: "Foo",
      lastName: `Zzonenwerk${tag}`,
    });

    const { req: req1 } = await authedReq({
      method: "GET",
      query: { search: `CAPITAL-EMAIL-${tag}` },
    });
    const res1 = makeRes();
    await listHandler(req1, res1);
    const body1 = res1.jsonBody as { submissions: Array<{ id: string }> };
    assert.ok(body1.submissions.some((s) => s.id === idByEmail));

    const { req: req2 } = await authedReq({
      method: "GET",
      query: { search: `zzonenwerk${tag}` },
    });
    const res2 = makeRes();
    await listHandler(req2, res2);
    const body2 = res2.jsonBody as { submissions: Array<{ id: string }> };
    assert.ok(body2.submissions.some((s) => s.id === idByLast));
  });

  it("rank=unscored matches rows with rank IS NULL", async () => {
    const idNull = await seedSubmission({ rank: null });
    const idA = await seedSubmission({ rank: "A" });

    const { req } = await authedReq({
      method: "GET",
      query: { rank: "unscored" },
    });
    const res = makeRes();
    await listHandler(req, res);
    const body = res.jsonBody as { submissions: Array<{ id: string; rank: string | null }> };
    assert.ok(body.submissions.some((s) => s.id === idNull));
    for (const s of body.submissions) assert.equal(s.rank, null);
    assert.ok(!body.submissions.some((s) => s.id === idA));
  });

  it("clamps limit to 100 even when caller asks for more", async () => {
    const { req } = await authedReq({
      method: "GET",
      query: { limit: "9999" },
    });
    const res = makeRes();
    await listHandler(req, res);
    assert.equal(res.statusCode, 200);
    const body = res.jsonBody as { submissions: Array<unknown> };
    assert.ok(body.submissions.length <= 100, "limit must be clamped");
  });
});

// ---------------------------------------------------------------------------
// GET /api/submissions/[id]
// ---------------------------------------------------------------------------

describe("GET /api/submissions/[id] — detail", () => {
  it("returns 401 without a session cookie", async () => {
    const req = makeReq({ method: "GET", query: { id: "00000000-0000-0000-0000-000000000000" } });
    const res = makeRes();
    await detailHandler(req, res);
    assert.equal(res.statusCode, 401);
  });

  it("returns 400 for a malformed id", async () => {
    const { req } = await authedReq({ method: "GET", query: { id: "not-a-uuid" } });
    const res = makeRes();
    await detailHandler(req, res);
    assert.equal(res.statusCode, 400);
  });

  it("returns 404 for an unknown but well-formed id", async () => {
    const { req } = await authedReq({
      method: "GET",
      query: { id: "00000000-0000-0000-0000-000000000000" },
    });
    const res = makeRes();
    await detailHandler(req, res);
    assert.equal(res.statusCode, 404);
  });

  it("returns full row including raw_payload + scoring_trace", async () => {
    const id = await seedSubmission();
    const { req } = await authedReq({ method: "GET", query: { id } });
    const res = makeRes();
    await detailHandler(req, res);
    assert.equal(res.statusCode, 200);
    const body = res.jsonBody as {
      submission: { id: string; rawPayload: unknown; scoringTrace: unknown };
      ruleSet: unknown;
    };
    assert.equal(body.submission.id, id);
    assert.ok(body.submission.rawPayload, "raw_payload should be returned");
    assert.ok(body.submission.scoringTrace, "scoring_trace should be returned");
  });
});

// ---------------------------------------------------------------------------
// GET /api/submissions/activity
// ---------------------------------------------------------------------------

describe("GET /api/submissions/activity — aggregation", () => {
  it("returns 401 without a session cookie", async () => {
    const req = makeReq({ method: "GET" });
    const res = makeRes();
    await activityHandler(req, res);
    assert.equal(res.statusCode, 401);
  });

  it("returns 90 daily buckets by default", async () => {
    const { req } = await authedReq({ method: "GET" });
    const res = makeRes();
    await activityHandler(req, res);
    assert.equal(res.statusCode, 200);
    const body = res.jsonBody as {
      daily_counts: Array<{ date: string; total: number }>;
      summary: { total: number; sent: number; errored: number; success_rate: number };
    };
    assert.equal(body.daily_counts.length, 90);
    // Each bucket has the YYYY-MM-DD shape.
    for (const b of body.daily_counts) {
      assert.match(b.date, /^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it("400 when start_date is after end_date", async () => {
    const { req } = await authedReq({
      method: "GET",
      query: { start_date: "2026-05-10", end_date: "2026-05-01" },
    });
    const res = makeRes();
    await activityHandler(req, res);
    assert.equal(res.statusCode, 400);
  });

  it("counts match a raw COUNT(*) for the same window", async () => {
    // Seed two rows today + one ten days ago.
    await seedSubmission({ createdAt: new Date() });
    await seedSubmission({ createdAt: new Date() });
    const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
    await seedSubmission({ createdAt: tenDaysAgo });

    const { req } = await authedReq({ method: "GET" });
    const res = makeRes();
    await activityHandler(req, res);
    const body = res.jsonBody as {
      start_date: string;
      end_date: string;
      summary: { total: number };
    };

    // Authoritative count over the same window via a fresh query.
    const startMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(body.start_date)!;
    const endMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(body.end_date)!;
    const start = new Date(
      Date.UTC(Number(startMatch[1]), Number(startMatch[2]) - 1, Number(startMatch[3])),
    );
    const endExcl = new Date(
      Date.UTC(
        Number(endMatch[1]),
        Number(endMatch[2]) - 1,
        Number(endMatch[3]) + 1,
      ),
    );
    const { db: dbRef, sql } = await import("@workspace/db");
    const rawCount = await dbRef.execute<{ c: string }>(sql`
      SELECT COUNT(*)::text AS c FROM submissions
      WHERE created_at >= ${start} AND created_at < ${endExcl}
    `);
    const expected = Number(rawCount.rows[0]?.c ?? 0);
    assert.equal(body.summary.total, expected);
  });
});
