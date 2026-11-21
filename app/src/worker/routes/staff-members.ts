import type { Hono } from "hono";
import { endpoints } from "@shared/api/endpoints.ts";
import { roleAtLeast, roleFromPermissions, type StaffRole } from "@shared/github/roles.ts";
import type {
  GitHubCollaborator,
  GitHubCollaboratorPermission,
  GitHubRepositoryInvitation,
} from "@shared/github/types.ts";
import {
  checkMemberMutation,
  collaboratorPermissionFor,
  invitationPermissionFor,
  normaliseUsername,
  roleFromCollaboratorPermission,
  roleFromGitHubPermission,
  sortStaffInvitations,
  sortStaffMembers,
  type MemberMutationRejection,
  type StaffInvitation,
  type StaffMember,
} from "@shared/staff/members.ts";
import { registerEndpoint } from "../api/register.ts";
import {
  createStaffClient,
  GitHubApiError,
  GitHubNetworkError,
  type GitHubRestClient,
} from "../github/rest-client.ts";

function toStaffMembers(
  allCollaborators: readonly GitHubCollaborator[],
  directCollaborators: readonly GitHubCollaborator[],
  callerLogin: string,
): StaffMember[] {
  const direct = new Set(directCollaborators.map((user) => user.login.toLowerCase()));
  const callerKey = callerLogin.toLowerCase();
  const seen = new Set<string>();
  const members: StaffMember[] = [];
  for (const collaborator of allCollaborators) {
    const key = collaborator.login.toLowerCase();
    if (seen.has(key)) continue;
    const role =
      roleFromPermissions(collaborator.permissions) ??
      roleFromGitHubPermission(collaborator.role_name);
    if (role === null) continue;
    seen.add(key);
    members.push({
      login: collaborator.login,
      role,
      managed: direct.has(key),
      isSelf: key === callerKey,
    });
  }
  return sortStaffMembers(members);
}

function toStaffInvitation(raw: GitHubRepositoryInvitation): StaffInvitation | null {
  if (!raw.invitee || typeof raw.invitee.login !== "string") return null;
  const role = roleFromGitHubPermission(raw.permissions);
  if (role === null) return null;
  return {
    id: raw.id,
    login: raw.invitee.login,
    role,
    invitedBy: raw.inviter?.login ?? null,
    createdAt: raw.created_at,
    expired: raw.expired === true,
  };
}

function toStaffInvitations(raw: readonly GitHubRepositoryInvitation[]): StaffInvitation[] {
  const invitations: StaffInvitation[] = [];
  for (const entry of raw) {
    const mapped = toStaffInvitation(entry);
    if (mapped) invitations.push(mapped);
  }
  return sortStaffInvitations(invitations);
}

type CommonGitHubFailCode =
  | "unauthorized"
  | "rate_limited"
  | "staff_permission_required"
  | "not_found"
  | "invalid_request"
  | "upstream_unavailable";

function mapGitHubFailure<C extends string>(
  error: unknown,
  fail: (code: CommonGitHubFailCode | C) => never,
  notFoundCode?: C,
): never {
  if (error instanceof GitHubApiError) {
    if (error.status === 401) return fail("unauthorized");
    if (error.rateLimited || error.status === 429) return fail("rate_limited");
    if (error.status === 403) return fail("staff_permission_required");
    if (error.status === 404) return fail(notFoundCode ?? "not_found");
    if (error.status === 422) return fail("invalid_request");
    return fail("upstream_unavailable");
  }
  if (error instanceof GitHubNetworkError) return fail("upstream_unavailable");
  return fail("upstream_unavailable");
}

async function loadManagedMember(
  gh: GitHubRestClient,
  callerLogin: string,
  rawUsername: string,
  nextRole: StaffRole | null,
  fail: (code: CommonGitHubFailCode | MemberMutationRejection | "invalid_username") => never,
): Promise<StaffMember> {
  const username = normaliseUsername(rawUsername);
  if (username === null) return fail("invalid_username");

  let members: StaffMember[];
  try {
    const [all, direct] = await Promise.all([
      gh.paginate<GitHubCollaborator>(gh.repoPath("/collaborators"), {
        query: { affiliation: "all" },
      }),
      gh.paginate<GitHubCollaborator>(gh.repoPath("/collaborators"), {
        query: { affiliation: "direct" },
      }),
    ]);
    members = toStaffMembers(all, direct, callerLogin);
  } catch (error) {
    return mapGitHubFailure(error, fail);
  }

  const rejection = checkMemberMutation(members, username, callerLogin, nextRole);
  if (rejection !== null) return fail(rejection);
  return members.find((m) => m.login.toLowerCase() === username.toLowerCase())!;
}

/**
 * Staff role management endpoints (SPEC 2.4, ADR 0006): System admin only (`role: "admin"`),
 * calling GitHub's repository collaborator and invitation endpoints with `caller.token`.
 */
export function registerStaffMembers(app: Hono<{ Bindings: Env }>): void {
  registerEndpoint(app, endpoints.staffMembersList, async ({ env, caller, fail }) => {
    const gh = createStaffClient(env, caller.token);
    try {
      const [all, direct, invitations] = await Promise.all([
        gh.paginate<GitHubCollaborator>(gh.repoPath("/collaborators"), {
          query: { affiliation: "all" },
        }),
        gh.paginate<GitHubCollaborator>(gh.repoPath("/collaborators"), {
          query: { affiliation: "direct" },
        }),
        gh.paginate<GitHubRepositoryInvitation>(gh.repoPath("/invitations")),
      ]);
      return {
        members: toStaffMembers(all, direct, caller.login),
        invitations: toStaffInvitations(invitations),
      };
    } catch (error) {
      return mapGitHubFailure(error, fail);
    }
  });

  registerEndpoint(app, endpoints.staffMemberAdd, async ({ env, caller, input, fail }) => {
    const username = normaliseUsername(input.username);
    if (username === null) return fail("invalid_username");

    const gh = createStaffClient(env, caller.token);
    let all: GitHubCollaborator[];
    let rawInvitations: GitHubRepositoryInvitation[];
    try {
      [all, rawInvitations] = await Promise.all([
        gh.paginate<GitHubCollaborator>(gh.repoPath("/collaborators"), {
          query: { affiliation: "all" },
        }),
        gh.paginate<GitHubRepositoryInvitation>(gh.repoPath("/invitations")),
      ]);
    } catch (error) {
      return mapGitHubFailure(error, fail);
    }

    const key = username.toLowerCase();
    if (all.some((user) => user.login.toLowerCase() === key)) return fail("already_staff");
    if (rawInvitations.some((inv) => inv.invitee?.login.toLowerCase() === key)) {
      return fail("already_invited");
    }

    let putResult: { status: number; data: GitHubRepositoryInvitation | undefined };
    try {
      putResult = await gh.request<GitHubRepositoryInvitation | undefined>(
        "PUT",
        gh.repoPath(`/collaborators/${encodeURIComponent(username)}`),
        { body: { permission: collaboratorPermissionFor(input.role) } },
      );
    } catch (error) {
      return mapGitHubFailure(error, fail, "github_user_not_found");
    }

    if (putResult.status === 201 && putResult.data) {
      const invitation = toStaffInvitation(putResult.data);
      if (!invitation) return fail("upstream_unavailable");
      return { outcome: "invited" as const, invitation };
    }

    // 204: existing GitHub Organization member gained access immediately; confirm canonical login & effective role.
    try {
      const { data } = await gh.request<GitHubCollaboratorPermission>(
        "GET",
        gh.repoPath(`/collaborators/${encodeURIComponent(username)}/permission`),
      );
      const login = data.user?.login ?? username;
      const role = roleFromCollaboratorPermission(data) ?? input.role;
      return {
        outcome: "added" as const,
        member: {
          login,
          role,
          managed: true,
          isSelf: login.toLowerCase() === caller.login.toLowerCase(),
        },
      };
    } catch (error) {
      return mapGitHubFailure(error, fail);
    }
  });

  registerEndpoint(app, endpoints.staffMemberRole, async ({ env, caller, input, fail }) => {
    const gh = createStaffClient(env, caller.token);
    const target = await loadManagedMember(gh, caller.login, input.username, input.role, fail);

    // Do not overwrite an existing GitHub Write/Maintain grant unless the dashboard role actually changed (ADR 0006).
    if (input.role === target.role) {
      return { member: target, overridden: false };
    }

    try {
      await gh.request("PUT", gh.repoPath(`/collaborators/${encodeURIComponent(target.login)}`), {
        body: { permission: collaboratorPermissionFor(input.role) },
      });
      const { data } = await gh.request<GitHubCollaboratorPermission>(
        "GET",
        gh.repoPath(`/collaborators/${encodeURIComponent(target.login)}/permission`),
      );
      const effectiveRole = roleFromCollaboratorPermission(data) ?? input.role;
      const overridden = !roleAtLeast(input.role, effectiveRole);
      return {
        member: { login: target.login, role: effectiveRole, managed: true, isSelf: false },
        overridden,
      };
    } catch (error) {
      return mapGitHubFailure(error, fail);
    }
  });

  registerEndpoint(app, endpoints.staffMemberRemove, async ({ env, caller, input, fail }) => {
    const gh = createStaffClient(env, caller.token);
    const target = await loadManagedMember(gh, caller.login, input.username, null, fail);

    try {
      await gh.request("DELETE", gh.repoPath(`/collaborators/${encodeURIComponent(target.login)}`));
    } catch (error) {
      return mapGitHubFailure(error, fail);
    }

    try {
      const { data } = await gh.request<GitHubCollaboratorPermission>(
        "GET",
        gh.repoPath(`/collaborators/${encodeURIComponent(target.login)}/permission`),
      );
      const effectiveRole = roleFromCollaboratorPermission(data);
      return { removed: true as const, overridden: effectiveRole !== null, effectiveRole };
    } catch (error) {
      if (error instanceof GitHubApiError && error.status === 404) {
        return { removed: true as const, overridden: false, effectiveRole: null };
      }
      return mapGitHubFailure(error, fail);
    }
  });

  registerEndpoint(app, endpoints.staffInvitationRole, async ({ env, caller, input, fail }) => {
    const gh = createStaffClient(env, caller.token);
    try {
      const { data } = await gh.request<GitHubRepositoryInvitation>(
        "PATCH",
        gh.repoPath(`/invitations/${input.invitationId}`),
        { body: { permissions: invitationPermissionFor(input.role) } },
      );
      const invitation = toStaffInvitation(data);
      if (!invitation) return fail("upstream_unavailable");
      return { invitation };
    } catch (error) {
      return mapGitHubFailure(error, fail);
    }
  });

  registerEndpoint(app, endpoints.staffInvitationCancel, async ({ env, caller, input, fail }) => {
    const gh = createStaffClient(env, caller.token);
    try {
      await gh.request("DELETE", gh.repoPath(`/invitations/${input.invitationId}`));
      return { cancelled: true as const };
    } catch (error) {
      return mapGitHubFailure(error, fail);
    }
  });
}
