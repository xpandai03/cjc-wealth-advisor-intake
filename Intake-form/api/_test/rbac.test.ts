// Pure unit tests for the RBAC primitives in api/_lib/roles.ts.
//
// roles.ts imports nothing — no DB, no env — so these run anywhere, unlike
// the endpoint integration tests in rbac-endpoints.test.ts (which need a
// live DATABASE_URL). This file is the authoritative test of the gating
// decision logic; the endpoint tests just verify the wiring.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ROLES, isRole, isRoleAllowed, parseRole } from "../_lib/roles";

describe("roles — ROLES", () => {
  it("is exactly [admin, marketing]", () => {
    assert.deepEqual([...ROLES], ["admin", "marketing"]);
  });
});

describe("roles — isRole", () => {
  it("true for the two known roles", () => {
    assert.equal(isRole("admin"), true);
    assert.equal(isRole("marketing"), true);
  });

  it("false for anything else (case-sensitive, no coercion)", () => {
    for (const v of ["Admin", "ADMIN", "manager", "", " ", null, undefined, 1, {}]) {
      assert.equal(isRole(v), false);
    }
  });
});

describe("roles — parseRole", () => {
  it("empty / null / undefined → 'admin' (the default)", () => {
    assert.equal(parseRole(undefined), "admin");
    assert.equal(parseRole(null), "admin");
    assert.equal(parseRole(""), "admin");
    assert.equal(parseRole("   "), "admin");
  });

  it("accepts admin / marketing, case- and whitespace-insensitive", () => {
    assert.equal(parseRole("admin"), "admin");
    assert.equal(parseRole("marketing"), "marketing");
    assert.equal(parseRole("  MARKETING  "), "marketing");
    assert.equal(parseRole("Admin"), "admin");
  });

  it("throws on any unrecognized value (loud, never a silent default)", () => {
    assert.throws(() => parseRole("manager"), /Invalid role/);
    assert.throws(() => parseRole("superadmin"), /Invalid role/);
    assert.throws(() => parseRole("admin marketing"), /Invalid role/);
  });
});

describe("roles — isRoleAllowed (fail-closed)", () => {
  it("admin is allowed wherever admin is listed", () => {
    assert.equal(isRoleAllowed("admin", ["admin"]), true);
    assert.equal(isRoleAllowed("admin", ["admin", "marketing"]), true);
  });

  it("marketing is allowed ONLY where marketing is listed", () => {
    assert.equal(isRoleAllowed("marketing", ["admin", "marketing"]), true);
    assert.equal(isRoleAllowed("marketing", ["admin"]), false);
  });

  it("unknown / missing role is never allowed", () => {
    assert.equal(isRoleAllowed("manager", ["admin", "marketing"]), false);
    assert.equal(isRoleAllowed(null, ["admin", "marketing"]), false);
    assert.equal(isRoleAllowed(undefined, ["admin", "marketing"]), false);
    assert.equal(isRoleAllowed("", ["admin", "marketing"]), false);
  });

  it("an empty allowed-list denies everyone", () => {
    assert.equal(isRoleAllowed("admin", []), false);
    assert.equal(isRoleAllowed("marketing", []), false);
  });
});
