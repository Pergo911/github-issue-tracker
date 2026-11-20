import type { GitHubRepoPermissions } from "./types.ts";

/**
 * The three dashboard roles (SPEC 2.4, GLOSSARY): GitHub's five repo roles collapse to these because Write
 * and Maintain add only code access the dashboard never uses. Ordered: a higher role includes the lower ones.
 */
export const STAFF_ROLES = ["viewer", "maintenance", "admin"] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

export function roleAtLeast(actual: StaffRole, required: StaffRole): boolean {
  return STAFF_ROLES.indexOf(actual) >= STAFF_ROLES.indexOf(required);
}

/**
 * Maps the repo `permissions` object to a dashboard role (SPEC 2.4). `triage` and `maintain` are optional in
 * GitHub's schema, so missing means false. No `permissions` object (or one without Read) means no access:
 * `null`, which every caller treats as deny.
 */
export function roleFromPermissions(
  permissions: Partial<GitHubRepoPermissions> | null | undefined,
): StaffRole | null {
  if (!permissions) return null;
  if (permissions.admin === true) return "admin";
  if (permissions.triage === true || permissions.push === true || permissions.maintain === true) {
    return "maintenance";
  }
  if (permissions.pull === true) return "viewer";
  return null;
}
