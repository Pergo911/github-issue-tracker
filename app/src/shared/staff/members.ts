import { roleFromPermissions, STAFF_ROLES, type StaffRole } from "../github/roles.ts";
import type { GitHubCollaboratorPermission, GitHubInvitationPermission } from "../github/types.ts";

/**
 * Staff role management types, username validation, role/permission mapping, and safety guards shared by the
 * Worker and the Staff dashboard (SPEC 2.4, ADR 0006).
 */

/** GitHub usernames: 1–39 ASCII alphanumeric characters or single hyphens, no leading/trailing hyphen. */
const GITHUB_USERNAME_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/;

export interface StaffMember {
  login: string;
  role: StaffRole;
  /** `true` when the member holds a direct repository grant (`affiliation=direct`); `false` when inherited-only. */
  managed: boolean;
  /** `true` when this member is the signed-in caller. */
  isSelf: boolean;
}

export interface StaffInvitation {
  id: number;
  login: string;
  role: StaffRole;
  invitedBy: string | null;
  createdAt: string;
  expired: boolean;
}

export interface StaffMembersList {
  members: StaffMember[];
  invitations: StaffInvitation[];
}

export type AddStaffResult =
  { outcome: "added"; member: StaffMember } | { outcome: "invited"; invitation: StaffInvitation };

export type MemberMutationRejection =
  "not_found" | "last_admin_required" | "cannot_modify_self" | "inherited_member_readonly";

/** Trims and validates a GitHub username; returns `null` if invalid (including email addresses). */
export function normaliseUsername(raw: string): string | null {
  const trimmed = raw.trim();
  return GITHUB_USERNAME_PATTERN.test(trimmed) ? trimmed : null;
}

/** GitHub `PUT /repos/{owner}/{repo}/collaborators/{username}` `permission` value for a dashboard role. */
export function collaboratorPermissionFor(role: StaffRole): "pull" | "triage" | "admin" {
  if (role === "admin") return "admin";
  if (role === "maintenance") return "triage";
  return "pull";
}

/** GitHub `PATCH /repos/{owner}/{repo}/invitations/{invitation_id}` `permissions` value for a dashboard role. */
export function invitationPermissionFor(
  role: StaffRole,
): Extract<GitHubInvitationPermission, "read" | "triage" | "admin"> {
  if (role === "admin") return "admin";
  if (role === "maintenance") return "triage";
  return "read";
}

/** Maps a GitHub role or invitation permission string (`read`/`pull`, `triage`/`write`/`maintain`, `admin`) to a dashboard role. */
export function roleFromGitHubPermission(permission: string | null | undefined): StaffRole | null {
  switch (permission?.toLowerCase()) {
    case "admin":
      return "admin";
    case "maintain":
    case "write":
    case "push":
    case "triage":
      return "maintenance";
    case "read":
    case "pull":
      return "viewer";
    default:
      return null;
  }
}

/**
 * Resolves the effective dashboard role from `GET /repos/{owner}/{repo}/collaborators/{username}/permission`.
 * Prefers `role_name` (GitHub's legacy `permission` collapses `triage` to `"read"`), then `user.permissions`
 * (for custom roles), and finally falls back to `permission`.
 */
export function roleFromCollaboratorPermission(
  data: Pick<GitHubCollaboratorPermission, "permission" | "role_name" | "user">,
): StaffRole | null {
  const roleName = data.role_name?.toLowerCase();
  if (roleName === "none") return null;
  const fromName = roleFromGitHubPermission(roleName);
  if (fromName !== null) return fromName;
  const fromPerms = roleFromPermissions(data.user?.permissions);
  if (fromPerms !== null) return fromPerms;
  return roleFromGitHubPermission(data.permission);
}

/**
 * Enforces the server-side safety guards before changing or removing a Staff member (ADR 0006):
 * - must be an active member (`not_found`)
 * - cannot demote or remove the last active effective System admin (`last_admin_required`)
 *   — counts every active effective `admin` including inherited GitHub Organization Owners, never pending invitations
 * - cannot change own role or remove self (`cannot_modify_self`)
 * - cannot modify or remove inherited-only members (`inherited_member_readonly`)
 */
export function checkMemberMutation(
  members: readonly StaffMember[],
  targetLogin: string,
  callerLogin: string,
  nextRole: StaffRole | null,
): MemberMutationRejection | null {
  const targetKey = targetLogin.toLowerCase();
  const target = members.find((member) => member.login.toLowerCase() === targetKey);
  if (!target) return "not_found";
  const removesAdmin = target.role === "admin" && nextRole !== "admin";
  if (removesAdmin) {
    const remainingAdmins = members.filter(
      (member) => member.role === "admin" && member.login.toLowerCase() !== targetKey,
    ).length;
    if (remainingAdmins === 0) return "last_admin_required";
  }
  if (targetKey === callerLogin.toLowerCase()) return "cannot_modify_self";
  if (!target.managed) return "inherited_member_readonly";
  return null;
}

/** Active members ordered by role descending (`admin`, `maintenance`, `viewer`), then login ascending. */
export function sortStaffMembers(members: readonly StaffMember[]): StaffMember[] {
  return [...members].sort((a, b) => {
    const roleDiff = STAFF_ROLES.indexOf(b.role) - STAFF_ROLES.indexOf(a.role);
    if (roleDiff !== 0) return roleDiff;
    const aLogin = a.login.toLowerCase();
    const bLogin = b.login.toLowerCase();
    return aLogin < bLogin ? -1 : aLogin > bLogin ? 1 : 0;
  });
}

/** Pending invitations ordered newest first, tie-broken by descending id. */
export function sortStaffInvitations(invitations: readonly StaffInvitation[]): StaffInvitation[] {
  return [...invitations].sort((a, b) => {
    const timeDiff = Date.parse(b.createdAt) - Date.parse(a.createdAt);
    return (Number.isNaN(timeDiff) ? 0 : timeDiff) || b.id - a.id;
  });
}
