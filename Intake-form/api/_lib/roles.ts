// Role-based access control primitives. Pure module — no DB, no HTTP, no
// env imports — so the gating logic stays unit-testable in isolation.
// (Anything importing @workspace/db throws when DATABASE_URL is unset,
// which would otherwise drag a live database into every RBAC test.)
//
// Two roles only — intentionally NOT a permissions system:
//   - admin      full access to every tab and endpoint (the pre-RBAC behavior)
//   - marketing  limited: Links, Submissions, Activity only
//
// New users default to 'admin' (the users.role column default), so existing
// accounts are unaffected.

export type Role = "admin" | "marketing";

export const ROLES: readonly Role[] = ["admin", "marketing"];

/** Type guard — true when `value` is one of the two known roles. */
export function isRole(value: unknown): value is Role {
  return value === "admin" || value === "marketing";
}

/**
 * Normalize a raw role string (e.g. an env var) to a Role. Empty/undefined
 * → 'admin' (the default). Throws on any other value so a typo'd role is a
 * loud failure, never a silent privilege grant or denial.
 */
export function parseRole(raw: string | null | undefined): Role {
  if (raw == null || raw.trim() === "") return "admin";
  const v = raw.trim().toLowerCase();
  if (isRole(v)) return v;
  throw new Error(`Invalid role "${raw}". Must be 'admin' or 'marketing'.`);
}

/**
 * True when `role` is permitted by the `allowed` list. An unknown/missing
 * role is never allowed (fail closed).
 */
export function isRoleAllowed(
  role: string | null | undefined,
  allowed: readonly Role[],
): boolean {
  return isRole(role) && allowed.includes(role);
}
