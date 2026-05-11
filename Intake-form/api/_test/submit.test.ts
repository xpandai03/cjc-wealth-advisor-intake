// Tests for the refactored /api/submit endpoint and the sf.ts helper.
//
// Scope: validation paths (no SF round-trip), prefix-strip invariant,
// and DB write on validation failures.
//
// Full SF integration is verified manually post-deploy (test plan in the
// Sprint 2 PR description). A mocked-SF version of these tests can land
// once we pick a mocking strategy compatible with our node:test setup.

import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { db, eq, submissions } from "@workspace/db";
import submitHandler from "../submit";
import {
  FEDERAL_AGENCY_PREFIX_PATTERN,
  strippedFederalAgency,
} from "../_lib/sf";
import { makeReq, makeRes } from "./harness";

before(() => {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL must be set to run submit tests");
  }
});

// ---------------------------------------------------------------------------
// Helper: clean up submissions rows created by these tests.
// ---------------------------------------------------------------------------

const createdEmails = new Set<string>();
function uniqueEmail(prefix = "submit"): string {
  return `test+sprint2-${prefix}-${Math.random().toString(36).slice(2, 10)}@xpand.test`;
}

after(async () => {
  for (const e of createdEmails) {
    await db.delete(submissions).where(eq(submissions.email, e));
  }
});

// ---------------------------------------------------------------------------
// strippedFederalAgency / FEDERAL_AGENCY_PREFIX_PATTERN — Phase 1 invariant.
// If this regression-tests breaks, the Path C ship is broken.
// ---------------------------------------------------------------------------

describe("Path C prefix strip — Phase 1 invariant", () => {
  it("strips the 4-space + ► + space sub-agency prefix", () => {
    const stripped = strippedFederalAgency(
      "    ► Dept of Defense (DOD): Navy",
    );
    assert.equal(stripped, "Dept of Defense (DOD): Navy");
  });

  it("strips leading whitespace only (no arrow)", () => {
    assert.equal(strippedFederalAgency("   Some Agency"), "Some Agency");
  });

  it("strips arrow without leading whitespace", () => {
    assert.equal(strippedFederalAgency("► Sub Agency"), "Sub Agency");
  });

  it("leaves top-level (un-prefixed) agencies unchanged", () => {
    assert.equal(
      strippedFederalAgency("Architect of the Capitol"),
      "Architect of the Capitol",
    );
  });

  it("regex matches the exact set of prefix characters", () => {
    // The regex must allow ANY combination of whitespace and ►. Don't
    // tighten without verifying against artifacts/intake-form/src/pages/Home.tsx.
    assert.equal(FEDERAL_AGENCY_PREFIX_PATTERN.test("    ► X"), true);
    assert.equal(FEDERAL_AGENCY_PREFIX_PATTERN.test("►X"), true);
    assert.equal(FEDERAL_AGENCY_PREFIX_PATTERN.test(" X"), true);
    assert.equal(FEDERAL_AGENCY_PREFIX_PATTERN.test("X"), false);
  });
});

// ---------------------------------------------------------------------------
// submit handler — validation paths
// ---------------------------------------------------------------------------

describe("POST /api/submit — method + body validation", () => {
  it("returns 405 for non-POST", async () => {
    const req = makeReq({ method: "GET" });
    const res = makeRes();
    await submitHandler(req, res);
    assert.equal(res.statusCode, 405);
  });

  it("returns 400 for missing required fields", async () => {
    const req = makeReq({
      method: "POST",
      body: { firstName: "x" },
    });
    const res = makeRes();
    await submitHandler(req, res);
    assert.equal(res.statusCode, 400);
    assert.equal(
      (res.jsonBody as { error: string }).error,
      "Invalid request body",
    );
  });

  it("returns 400 for invalid email format", async () => {
    const req = makeReq({
      method: "POST",
      body: {
        firstName: "First",
        lastName: "Last",
        email: "not-an-email",
        phone: "5551234",
        stateResidence: "DC",
        agency: "Architect of the Capitol",
      },
    });
    const res = makeRes();
    await submitHandler(req, res);
    assert.equal(res.statusCode, 400);
  });

  it("returns 400 when federalAgency is missing/empty", async () => {
    const email = uniqueEmail("noagency");
    createdEmails.add(email);
    const req = makeReq({
      method: "POST",
      body: {
        firstName: "First",
        lastName: "Last",
        email,
        phone: "5551234",
        stateResidence: "DC",
        // no agency
      },
    });
    const res = makeRes();
    await submitHandler(req, res);
    assert.equal(res.statusCode, 400);
    assert.match(
      (res.jsonBody as { error: string }).error,
      /federalAgency/,
    );
  });
});

// ---------------------------------------------------------------------------
// submit handler — full flow with SF env missing → marks sf_status='error'
// ---------------------------------------------------------------------------

describe("POST /api/submit — full flow (SF env missing → graceful error)", () => {
  it("persists the submission row even when SF push fails", async () => {
    const email = uniqueEmail("sferror");
    createdEmails.add(email);
    // Ensure SF env is NOT set so the SF call deliberately fails. Tests
    // run with only DATABASE_URL exported; SF_* vars are absent.
    const originalClientId = process.env.SF_CLIENT_ID;
    delete process.env.SF_CLIENT_ID;
    try {
      const req = makeReq({
        method: "POST",
        body: {
          firstName: "Sprint2",
          lastName: "Test",
          email,
          phone: "5551234567",
          stateResidence: "DC",
          agency: "Architect of the Capitol",
          preRetirementReview: "Yes",
          age: "59 1/2 or over",
          maritalStatus: "Yes",
          maxingTsp: "YES",
          externalInvestments: "YES",
          tspBalance: "Over $1 million",
          separating: "NO",
          source: "federal",
        },
      });
      const res = makeRes();
      await submitHandler(req, res);
      // Either 502 (SF call attempted + failed) or 500 (env validation
      // threw before reaching SF) — both leave a DB row with sfStatus=error.
      assert.ok(
        res.statusCode === 502 || res.statusCode === 500,
        `expected 502 or 500, got ${res.statusCode}`,
      );

      const rows = await db
        .select()
        .from(submissions)
        .where(eq(submissions.email, email));
      assert.equal(rows.length, 1);
      const row = rows[0];
      // The row should have been written, scoring should have run, and
      // sfStatus should be 'error'.
      assert.equal(row.sfStatus, "error");
      assert.equal(row.firstName, "Sprint2");
      assert.equal(row.federalAgency, "Architect of the Capitol");
      // Scoring ran: rank=A, leadScore=10 (over $1mm) for this lead.
      assert.equal(row.rank, "A");
      assert.equal(row.leadScore, "10  (over $1mm)");
      // Trace JSON should be present.
      assert.ok(row.scoringTrace, "scoring_trace should be populated");
    } finally {
      if (originalClientId) {
        process.env.SF_CLIENT_ID = originalClientId;
      }
    }
  });

  it("strips the Federal_Agency__c prefix before persisting", async () => {
    const email = uniqueEmail("prefix");
    createdEmails.add(email);
    delete process.env.SF_CLIENT_ID;
    const req = makeReq({
      method: "POST",
      body: {
        firstName: "Prefix",
        lastName: "Test",
        email,
        phone: "5551234567",
        stateResidence: "DC",
        // Sub-agency picklist value with the full 4-space + ► + space prefix.
        agency: "    ► Dept of Defense (DOD): Navy",
        preRetirementReview: "No",
        source: "federal",
      },
    });
    const res = makeRes();
    await submitHandler(req, res);

    const rows = await db
      .select()
      .from(submissions)
      .where(eq(submissions.email, email));
    assert.equal(rows.length, 1);
    // The persisted federal_agency must be bare — no prefix. SF rejects
    // the prefixed form via REST, so this is the Phase 1 invariant.
    assert.equal(rows[0].federalAgency, "Dept of Defense (DOD): Navy");
  });
});
