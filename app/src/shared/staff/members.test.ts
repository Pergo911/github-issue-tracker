import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  checkMemberMutation,
  collaboratorPermissionFor,
  invitationPermissionFor,
  normaliseUsername,
  roleFromCollaboratorPermission,
  roleFromGitHubPermission,
  sortStaffInvitations,
  sortStaffMembers,
  type StaffInvitation,
  type StaffMember,
} from "./members.ts";

describe("normaliseUsername", () => {
  it("accepts valid GitHub usernames and trims surrounding whitespace", () => {
    expect(normaliseUsername("octocat")).toBe("octocat");
    expect(normaliseUsername("  Ada-Admin-1  ")).toBe("Ada-Admin-1");
    expect(normaliseUsername("a")).toBe("a");
    expect(normaliseUsername("a".repeat(39))).toBe("a".repeat(39));
  });

  it("rejects empty, overlong, hyphen-broken, and non-alphanumeric usernames including emails", () => {
    for (const bad of [
      "",
      "   ",
      "-leading",
      "trailing-",
      "double--hyphen",
      "under_score",
      "dot.name",
      "has space",
      "@octocat",
      "anna@example.hu",
      "árvíz",
      "a".repeat(40),
    ]) {
      expect(normaliseUsername(bad), bad).toBeNull();
    }
  });

  it("accepts any generated valid GitHub username and rejects anything with @ or spaces", () => {
    const validArb = fc
      .array(fc.stringMatching(/^[A-Za-z0-9]{1,8}$/), { minLength: 1, maxLength: 4 })
      .map((parts) => parts.join("-"))
      .filter((name) => name.length <= 39);
    fc.assert(
      fc.property(validArb, (name) => {
        expect(normaliseUsername(`  ${name} `)).toBe(name);
      }),
    );
    fc.assert(
      fc.property(fc.emailAddress(), (email) => {
        expect(normaliseUsername(email)).toBeNull();
      }),
    );
  });
});

describe("dashboard role <-> GitHub permission mappings", () => {
  it("maps dashboard roles to GitHub collaborator PUT permissions", () => {
    expect(collaboratorPermissionFor("viewer")).toBe("pull");
    expect(collaboratorPermissionFor("maintenance")).toBe("triage");
    expect(collaboratorPermissionFor("admin")).toBe("admin");
  });

  it("maps dashboard roles to GitHub invitation PATCH permissions (read, not pull)", () => {
    expect(invitationPermissionFor("viewer")).toBe("read");
    expect(invitationPermissionFor("maintenance")).toBe("triage");
    expect(invitationPermissionFor("admin")).toBe("admin");
  });

  it("maps GitHub permission names and collapses write/maintain to maintenance", () => {
    expect(roleFromGitHubPermission("read")).toBe("viewer");
    expect(roleFromGitHubPermission("pull")).toBe("viewer");
    expect(roleFromGitHubPermission("triage")).toBe("maintenance");
    expect(roleFromGitHubPermission("write")).toBe("maintenance");
    expect(roleFromGitHubPermission("maintain")).toBe("maintenance");
    expect(roleFromGitHubPermission("admin")).toBe("admin");
    expect(roleFromGitHubPermission("none")).toBeNull();
    expect(roleFromGitHubPermission(undefined)).toBeNull();
  });

  it("reads effective role from collaborator permission responses, preferring role_name over legacy permission", () => {
    // GitHub's legacy `permission` field maps `triage` to `"read"`: `role_name` preserves triage.
    expect(
      roleFromCollaboratorPermission({ permission: "read", role_name: "triage", user: null }),
    ).toBe("maintenance");
    expect(
      roleFromCollaboratorPermission({ permission: "write", role_name: "maintain", user: null }),
    ).toBe("maintenance");
    expect(
      roleFromCollaboratorPermission({ permission: "write", role_name: "write", user: null }),
    ).toBe("maintenance");
    expect(
      roleFromCollaboratorPermission({ permission: "read", role_name: "read", user: null }),
    ).toBe("viewer");
    expect(
      roleFromCollaboratorPermission({ permission: "admin", role_name: "admin", user: null }),
    ).toBe("admin");
    expect(
      roleFromCollaboratorPermission({ permission: "none", role_name: "none", user: null }),
    ).toBeNull();
    // Custom role falls back to user.permissions when available.
    expect(
      roleFromCollaboratorPermission({
        permission: "read",
        role_name: "custom-triage",
        user: {
          id: 1,
          login: "alice",
          node_id: "U_1",
          avatar_url: "",
          html_url: "",
          type: "User",
          site_admin: false,
          permissions: { pull: true, triage: true, push: false, maintain: false, admin: false },
        },
      }),
    ).toBe("maintenance");
  });
});

describe("checkMemberMutation", () => {
  const member = (
    login: string,
    role: StaffMember["role"],
    options: { managed?: boolean; isSelf?: boolean } = {},
  ): StaffMember => ({
    login,
    role,
    managed: options.managed ?? true,
    isSelf: options.isSelf ?? false,
  });

  it("blocks demoting or removing the last active System admin", () => {
    const list = [member("ada", "admin", { isSelf: true }), member("mate", "maintenance")];
    expect(checkMemberMutation(list, "ada", "ada", "maintenance")).toBe("last_admin_required");
    expect(checkMemberMutation(list, "ada", "ada", null)).toBe("last_admin_required");
    // Even in a race where another caller acts on the sole admin:
    expect(checkMemberMutation([member("ada", "admin")], "ada", "other", "viewer")).toBe(
      "last_admin_required",
    );
    expect(checkMemberMutation([member("ada", "admin")], "ada", "other", null)).toBe(
      "last_admin_required",
    );
  });

  it("counts inherited GitHub Organization Owners toward active System admins", () => {
    const list = [
      member("ada", "admin", { managed: true, isSelf: true }),
      member("org-owner", "admin", { managed: false }),
    ];
    // org-owner counts as a second active admin, so ada hits cannot_modify_self rather than last_admin_required.
    expect(checkMemberMutation(list, "ada", "ada", "maintenance")).toBe("cannot_modify_self");
    // And a direct admin (bob) can be demoted when an inherited owner remains.
    const withBob = [
      member("org-owner", "admin", { managed: false }),
      member("bob", "admin", { managed: true }),
    ];
    expect(checkMemberMutation(withBob, "bob", "org-owner", "viewer")).toBeNull();
    expect(checkMemberMutation(withBob, "bob", "org-owner", null)).toBeNull();
  });

  it("blocks modifying self case-insensitively even when other admins exist", () => {
    const list = [member("Ada", "admin", { isSelf: true }), member("Bob", "admin")];
    expect(checkMemberMutation(list, "ada", "Ada", "viewer")).toBe("cannot_modify_self");
    expect(checkMemberMutation(list, "ADA", "ada", "admin")).toBe("cannot_modify_self");
    expect(checkMemberMutation(list, "ada", "ada", null)).toBe("cannot_modify_self");
  });

  it("blocks modifying or removing inherited-only members", () => {
    const list = [
      member("ada", "admin", { isSelf: true }),
      member("team-tech", "maintenance", { managed: false }),
      member("org-owner", "admin", { managed: false }),
    ];
    expect(checkMemberMutation(list, "team-tech", "ada", "viewer")).toBe(
      "inherited_member_readonly",
    );
    expect(checkMemberMutation(list, "team-tech", "ada", null)).toBe("inherited_member_readonly");
    expect(checkMemberMutation(list, "org-owner", "ada", "viewer")).toBe(
      "inherited_member_readonly",
    );
  });

  it("returns not_found when the username is not an active member, and null when allowed", () => {
    const list = [member("ada", "admin", { isSelf: true }), member("mate", "maintenance")];
    expect(checkMemberMutation(list, "ghost", "ada", "viewer")).toBe("not_found");
    expect(checkMemberMutation(list, "mate", "ada", "admin")).toBeNull();
    expect(checkMemberMutation(list, "mate", "ada", null)).toBeNull();
  });
});

describe("sorting helpers", () => {
  it("orders active members by role descending, then login ascending", () => {
    const sorted = sortStaffMembers([
      { login: "zoe", role: "viewer", managed: true, isSelf: false },
      { login: "bob", role: "admin", managed: true, isSelf: false },
      { login: "ada", role: "admin", managed: true, isSelf: true },
      { login: "mate", role: "maintenance", managed: true, isSelf: false },
      { login: "anna", role: "viewer", managed: true, isSelf: false },
    ]);
    expect(sorted.map((m) => m.login)).toEqual(["ada", "bob", "mate", "anna", "zoe"]);
  });

  it("orders invitations newest first", () => {
    const inv = (id: number, createdAt: string): StaffInvitation => ({
      id,
      login: `u${id}`,
      role: "viewer",
      invitedBy: "ada",
      createdAt,
      expired: false,
    });
    const sorted = sortStaffInvitations([
      inv(1, "2026-05-01T10:00:00Z"),
      inv(3, "2026-05-03T10:00:00Z"),
      inv(2, "2026-05-03T10:00:00Z"),
    ]);
    expect(sorted.map((i) => i.id)).toEqual([3, 2, 1]);
  });
});
