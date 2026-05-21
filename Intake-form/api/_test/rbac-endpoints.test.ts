// Integration tests for RBAC endpoint gating. Real DB hits — same
// convention as submissions.test.ts; requires DATABASE_URL (runs in CI,
// not locally). The pure role-decision logic is covered DB-free in
// rbac.test.ts; this file verifies the wiring — that requireRole on the
// real handlers returns 200 / 403 / 401 for the right role × endpoint mix.

import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import rulesHandler from "../rules/published";
import submissionsHandler from "../submissions/index";
import activityHandler from "../submissions/activity";
import marketingSourcesHandler from "../admin/marketing-sources";
import { SESSION_COOKIE_NAME } from "../_lib/auth";
import { cleanupAll, createTestUser, makeSessionFor } from "./fixtures";
import { makeReq, makeRes } from "./harness";

before(() => {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL must be set to run RBAC endpoint tests");
  }
});

after(async () => {
  await cleanupAll();
});

async function sessionCookieFor(
  role: "admin" | "marketing",
): Promise<string> {
  const { user } = await createTestUser({ role });
  const sessionId = await makeSessionFor(user.id);
  return `${SESSION_COOKIE_NAME}=${sessionId}`;
}

describe("RBAC — marketing role: allowed endpoints → 200", () => {
  it("GET /api/submissions", async () => {
    const cookie = await sessionCookieFor("marketing");
    const res = makeRes();
    await submissionsHandler(makeReq({ method: "GET", cookie }), res);
    assert.equal(res.statusCode, 200);
  });

  it("GET /api/submissions/activity", async () => {
    const cookie = await sessionCookieFor("marketing");
    const res = makeRes();
    await activityHandler(makeReq({ method: "GET", cookie }), res);
    assert.equal(res.statusCode, 200);
  });

  it("GET /api/admin/marketing-sources (the Links tab depends on this)", async () => {
    const cookie = await sessionCookieFor("marketing");
    const res = makeRes();
    await marketingSourcesHandler(makeReq({ method: "GET", cookie }), res);
    assert.equal(res.statusCode, 200);
  });
});

describe("RBAC — marketing role: forbidden endpoints → 403", () => {
  it("GET /api/rules/published", async () => {
    const cookie = await sessionCookieFor("marketing");
    const res = makeRes();
    await rulesHandler(makeReq({ method: "GET", cookie }), res);
    assert.equal(res.statusCode, 403);
    assert.deepEqual(res.jsonBody, { error: "forbidden" });
  });

  it("POST /api/admin/marketing-sources (create is admin-only)", async () => {
    const cookie = await sessionCookieFor("marketing");
    const res = makeRes();
    await marketingSourcesHandler(
      makeReq({ method: "POST", cookie, body: {} }),
      res,
    );
    assert.equal(res.statusCode, 403);
    assert.deepEqual(res.jsonBody, { error: "forbidden" });
  });
});

describe("RBAC — admin role retains full access (regression)", () => {
  it("GET /api/rules/published is not blocked (200 or 404, never 401/403)", async () => {
    // 404 is valid when the test DB has no published rule set — the point
    // is only that RBAC does not block an admin.
    const cookie = await sessionCookieFor("admin");
    const res = makeRes();
    await rulesHandler(makeReq({ method: "GET", cookie }), res);
    assert.notEqual(res.statusCode, 401);
    assert.notEqual(res.statusCode, 403);
  });

  it("GET /api/submissions → 200", async () => {
    const cookie = await sessionCookieFor("admin");
    const res = makeRes();
    await submissionsHandler(makeReq({ method: "GET", cookie }), res);
    assert.equal(res.statusCode, 200);
  });
});

describe("RBAC — unauthenticated → 401 (unchanged behavior)", () => {
  it("GET /api/rules/published without a session cookie", async () => {
    const res = makeRes();
    await rulesHandler(makeReq({ method: "GET" }), res);
    assert.equal(res.statusCode, 401);
  });

  it("GET /api/submissions without a session cookie", async () => {
    const res = makeRes();
    await submissionsHandler(makeReq({ method: "GET" }), res);
    assert.equal(res.statusCode, 401);
  });
});
