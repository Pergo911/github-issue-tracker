import { describe, expect, it } from "vitest";
import { castedWorld } from "../testing/bot.ts";
import { createTestWorld } from "../testing/world.ts";

// The fake GitHub's repository collaborator and invitation endpoints (ADR 0006, ticket #40):
// affiliation filtering (all|direct|outside), GitHub Organization member immediate grant (204) vs outside-account invitation (201),
// removal revoking access and unassigning open issues, inherited GitHub Organization or team grants and effective permissions,
// invitation CRUD, and missing Repository `Administration` permission (403).

describe("GET /repos/:owner/:repo/collaborators", () => {
  it("lists collaborators by affiliation=all, direct, and outside, with permissions and role_name", async () => {
    const { world, client, org, repo } = await createTestWorld();
    const admin = world.control.addStaff({ login: "ada-admin", role: "admin" });
    world.control.addStaff({ login: "mate-write", role: "write" });
    world.control.addStaff({ login: "org-owner", role: "none", inheritedRole: "admin" });
    world.control.addStaff({ login: "team-triage", role: "none", inheritedRole: "triage" });
    world.control.addStaff({ login: "ext-viewer", role: "read", orgMember: false });
    world.control.addStaff({ login: "org-no-access", role: "none", orgMember: true });
    world.control.addStaff({ login: "total-outsider", role: "none", orgMember: false });

    const all = await client.github("GET", `/repos/${org}/${repo}/collaborators`, {
      token: admin.token,
      query: { affiliation: "all", per_page: 100 },
    });
    expect(all.status).toBe(200);
    expect(all.json.map((u: { login: string }) => u.login).sort()).toEqual([
      "ada-admin",
      "ext-viewer",
      "mate-write",
      "org-owner",
      "team-triage",
    ]);
    const owner = all.json.find((u: { login: string }) => u.login === "org-owner");
    expect(owner.permissions).toEqual({
      admin: true,
      maintain: true,
      push: true,
      triage: true,
      pull: true,
    });
    expect(owner.role_name).toBe("admin");

    const direct = await client.github("GET", `/repos/${org}/${repo}/collaborators`, {
      token: admin.token,
      query: { affiliation: "direct", per_page: 100 },
    });
    expect(direct.status).toBe(200);
    expect(direct.json.map((u: { login: string }) => u.login).sort()).toEqual([
      "ada-admin",
      "ext-viewer",
      "mate-write",
    ]);

    const outside = await client.github("GET", `/repos/${org}/${repo}/collaborators`, {
      token: admin.token,
      query: { affiliation: "outside", per_page: 100 },
    });
    expect(outside.status).toBe(200);
    expect(outside.json.map((u: { login: string }) => u.login)).toEqual(["ext-viewer"]);
  });

  it("returns Cache-Control and ETag on collaborators and invitations and answers 304 on If-None-Match", async () => {
    const { world, client, org, repo } = await createTestWorld();
    const admin = world.control.addStaff({ login: "ada-admin", role: "admin" });
    for (const endpoint of [
      `/repos/${org}/${repo}/collaborators`,
      `/repos/${org}/${repo}/invitations`,
    ]) {
      const first = await client.github("GET", endpoint, { token: admin.token });
      expect(first.status).toBe(200);
      expect(first.headers.get("cache-control")).toBe("private, max-age=60, s-maxage=60");
      const etag = first.headers.get("etag")!;
      expect(etag).toBeTruthy();
      const second = await client.github("GET", endpoint, {
        token: admin.token,
        headers: { "if-none-match": etag },
      });
      expect(second.status).toBe(304);
    }
  });

  it("paginates collaborators with Link headers", async () => {
    const { world, client, org, repo } = await createTestWorld();
    const admin = world.control.addStaff({ login: "ada-admin", role: "admin" });
    world.control.addStaff({ login: "u1", role: "read" });
    world.control.addStaff({ login: "u2", role: "triage" });
    world.control.addStaff({ login: "u3", role: "read" });

    const first = await client.github("GET", `/repos/${org}/${repo}/collaborators`, {
      token: admin.token,
      query: { affiliation: "all", per_page: 2 },
    });
    expect(first.status).toBe(200);
    expect(first.json).toHaveLength(2);
    expect(first.headers.get("link")).toContain('rel="next"');
  });

  it("rejects an invalid affiliation with 422", async () => {
    const { world, client, org, repo } = await createTestWorld();
    const admin = world.control.addStaff({ login: "ada-admin", role: "admin" });
    const reply = await client.github("GET", `/repos/${org}/${repo}/collaborators`, {
      token: admin.token,
      query: { affiliation: "bogus" },
    });
    expect(reply.status).toBe(422);
  });
});

describe("PUT and DELETE /repos/:owner/:repo/collaborators/:username", () => {
  it("grants immediate access (204) to an existing GitHub Organization member and updates roles", async () => {
    const { world, client, org, repo } = await createTestWorld();
    const admin = world.control.addStaff({ login: "ada-admin", role: "admin" });
    const member = world.control.addStaff({ login: "org-jane", role: "none", orgMember: true });

    expect(
      (await client.github("GET", `/repos/${org}/${repo}`, { token: member.token })).status,
    ).toBe(404);

    const added = await client.github("PUT", `/repos/${org}/${repo}/collaborators/org-jane`, {
      token: admin.token,
      json: { permission: "triage" },
    });
    expect(added.status).toBe(204);

    const repoGet = await client.github("GET", `/repos/${org}/${repo}`, { token: member.token });
    expect(repoGet.status).toBe(200);
    expect(repoGet.json.permissions).toMatchObject({ triage: true, push: false, admin: false });

    const upgraded = await client.github("PUT", `/repos/${org}/${repo}/collaborators/ORG-JANE`, {
      token: admin.token,
      json: { permission: "admin" },
    });
    expect(upgraded.status).toBe(204);
    const perm = await client.github(
      "GET",
      `/repos/${org}/${repo}/collaborators/org-jane/permission`,
      { token: admin.token },
    );
    expect(perm.status).toBe(200);
    expect(perm.json).toMatchObject({ permission: "admin", role_name: "admin" });
  });

  it("sends an outside-collaborator invitation (201) for an outside account and returns 404 for unknown accounts", async () => {
    const { world, client, org, repo } = await createTestWorld();
    const admin = world.control.addStaff({ login: "ada-admin", role: "admin" });
    world.control.addStaff({ login: "nora-outside", role: "none", orgMember: false });

    const missing = await client.github("PUT", `/repos/${org}/${repo}/collaborators/no-such-user`, {
      token: admin.token,
      json: { permission: "pull" },
    });
    expect(missing.status).toBe(404);

    const invited = await client.github("PUT", `/repos/${org}/${repo}/collaborators/nora-outside`, {
      token: admin.token,
      json: { permission: "pull" },
    });
    expect(invited.status).toBe(201);
    expect(invited.json).toMatchObject({
      permissions: "read",
      invitee: { login: "nora-outside" },
      inviter: { login: "ada-admin" },
    });
    expect(typeof invited.json.id).toBe("number");
  });

  it("DELETE revokes access immediately and unassigns open issues, leaving closed issues untouched", async () => {
    const { world, client, org, repo } = await createTestWorld();
    const admin = world.control.addStaff({ login: "ada-admin", role: "admin" });
    const tech = world.control.addStaff({ login: "mate-tech", role: "triage" });

    const openReport = world.control.createReport({
      title: "Open report",
      assignees: ["mate-tech"],
    });
    const closedReport = world.control.createReport({
      title: "Closed report",
      assignees: ["mate-tech"],
      state: "closed",
      stateReason: "completed",
    });

    const removed = await client.github("DELETE", `/repos/${org}/${repo}/collaborators/mate-tech`, {
      token: admin.token,
    });
    expect(removed.status).toBe(204);

    // Access is gone immediately.
    expect(
      (await client.github("GET", `/repos/${org}/${repo}`, { token: tech.token })).status,
    ).toBe(404);
    const perm = await client.github(
      "GET",
      `/repos/${org}/${repo}/collaborators/mate-tech/permission`,
      { token: admin.token },
    );
    expect(perm.status).toBe(200);
    expect(perm.json).toMatchObject({ permission: "none", role_name: "none" });

    // Open report is unassigned; closed report keeps historical assignee.
    const openAfter = await client.github(
      "GET",
      `/repos/${org}/${repo}/issues/${openReport.number}`,
      {
        token: admin.token,
      },
    );
    expect(openAfter.json.assignees).toEqual([]);
    const closedAfter = await client.github(
      "GET",
      `/repos/${org}/${repo}/issues/${closedReport.number}`,
      { token: admin.token },
    );
    expect(closedAfter.json.assignees.map((u: { login: string }) => u.login)).toEqual([
      "mate-tech",
    ]);
  });

  it("preserves overlapping inherited GitHub Organization or team grants on direct downgrade or removal and reports triage via role_name", async () => {
    const { world, client, org, repo } = await createTestWorld();
    const admin = world.control.addStaff({ login: "ada-admin", role: "admin" });
    const dual = world.control.addStaff({
      login: "dual-member",
      role: "admin",
      inheritedRole: "triage",
    });

    // Direct downgrade to pull still has effective role triage because of inheritedRole.
    const downgraded = await client.github(
      "PUT",
      `/repos/${org}/${repo}/collaborators/dual-member`,
      {
        token: admin.token,
        json: { permission: "pull" },
      },
    );
    expect(downgraded.status).toBe(204);

    const permAfterDown = await client.github(
      "GET",
      `/repos/${org}/${repo}/collaborators/dual-member/permission`,
      { token: admin.token },
    );
    expect(permAfterDown.status).toBe(200);
    // Legacy `permission` maps triage -> read, while `role_name` is triage and user.permissions.triage is true.
    expect(permAfterDown.json).toMatchObject({
      permission: "read",
      role_name: "triage",
      user: { login: "dual-member", permissions: { triage: true, pull: true, admin: false } },
    });

    // Direct removal leaves inherited triage access intact.
    const removed = await client.github(
      "DELETE",
      `/repos/${org}/${repo}/collaborators/dual-member`,
      {
        token: admin.token,
      },
    );
    expect(removed.status).toBe(204);
    const repoGet = await client.github("GET", `/repos/${org}/${repo}`, { token: dual.token });
    expect(repoGet.status).toBe(200);
    expect(repoGet.json.permissions).toMatchObject({ triage: true, admin: false });

    const direct = await client.github("GET", `/repos/${org}/${repo}/collaborators`, {
      token: admin.token,
      query: { affiliation: "direct" },
    });
    expect(direct.json.map((u: { login: string }) => u.login)).not.toContain("dual-member");
  });
});

describe("pending invitations: GET, PATCH, DELETE", () => {
  it("lists, updates permissions (read/triage/admin; rejects pull), and cancels invitations", async () => {
    const { world, client, org, repo } = await createTestWorld();
    const admin = world.control.addStaff({ login: "ada-admin", role: "admin" });
    world.control.addStaff({ login: "ext-bob", role: "none", orgMember: false });

    const created = await client.github("PUT", `/repos/${org}/${repo}/collaborators/ext-bob`, {
      token: admin.token,
      json: { permission: "pull" },
    });
    expect(created.status).toBe(201);
    const id: number = created.json.id;

    const listed = await client.github("GET", `/repos/${org}/${repo}/invitations`, {
      token: admin.token,
    });
    expect(listed.status).toBe(200);
    expect(listed.json).toHaveLength(1);
    expect(listed.json[0]).toMatchObject({
      id,
      permissions: "read",
      invitee: { login: "ext-bob" },
    });

    // GitHub PATCH /invitations expects `read`, not `pull`.
    const invalidPatch = await client.github("PATCH", `/repos/${org}/${repo}/invitations/${id}`, {
      token: admin.token,
      json: { permissions: "pull" },
    });
    expect(invalidPatch.status).toBe(422);

    const patched = await client.github("PATCH", `/repos/${org}/${repo}/invitations/${id}`, {
      token: admin.token,
      json: { permissions: "triage" },
    });
    expect(patched.status).toBe(200);
    expect(patched.json).toMatchObject({ id, permissions: "triage" });

    const deleted = await client.github("DELETE", `/repos/${org}/${repo}/invitations/${id}`, {
      token: admin.token,
    });
    expect(deleted.status).toBe(204);
    expect(
      (
        await client.github("DELETE", `/repos/${org}/${repo}/invitations/${id}`, {
          token: admin.token,
        })
      ).status,
    ).toBe(404);
    const after = await client.github("GET", `/repos/${org}/${repo}/invitations`, {
      token: admin.token,
    });
    expect(after.json).toEqual([]);
  });
});

describe("Administration permission and Bot isolation", () => {
  it("returns 403 when the Staff App or stale token lacks Administration permission, while GET repo still succeeds", async () => {
    const { world, client, org, repo } = await createTestWorld();
    const staleAdmin = world.control.addStaff({
      login: "stale-admin",
      role: "admin",
      hasAdminPermission: false,
    });
    const freshAdmin = world.control.addStaff({ login: "fresh-admin", role: "admin" });

    // requireRole("admin") only calls GET /repos and GET /user, so it succeeds for stale-admin:
    expect(
      (await client.github("GET", `/repos/${org}/${repo}`, { token: staleAdmin.token })).status,
    ).toBe(200);

    // Collaborator and invitation endpoints answer 403 for stale-admin:
    expect(
      (
        await client.github("GET", `/repos/${org}/${repo}/collaborators`, {
          token: staleAdmin.token,
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await client.github("GET", `/repos/${org}/${repo}/invitations`, {
          token: staleAdmin.token,
        })
      ).status,
    ).toBe(403);

    // Fresh admin still works until the world-level switch disables Staff App Administration:
    expect(
      (
        await client.github("GET", `/repos/${org}/${repo}/collaborators`, {
          token: freshAdmin.token,
        })
      ).status,
    ).toBe(200);

    world.control.configure({ staffAppAdministration: false });
    expect(
      (
        await client.github("GET", `/repos/${org}/${repo}/collaborators`, {
          token: freshAdmin.token,
        })
      ).status,
    ).toBe(403);
  });

  it("refuses the Bot installation token and non-admin Staff tokens with 403", async () => {
    const test = await createTestWorld();
    const cast = await castedWorld(test);
    const { client, org, repo } = test;

    // Bot never has Administration permission (ADR 0006):
    expect(
      (await client.github("GET", `/repos/${org}/${repo}/collaborators`, { token: cast.bot }))
        .status,
    ).toBe(403);
    expect(
      (await client.github("GET", `/repos/${org}/${repo}/invitations`, { token: cast.bot })).status,
    ).toBe(403);
    expect(
      (
        await client.github("PUT", `/repos/${org}/${repo}/collaborators/vera`, {
          token: cast.bot,
          json: { permission: "triage" },
        })
      ).status,
    ).toBe(403);

    // Viewer and Triage are also refused:
    for (const token of [cast.read, cast.triage]) {
      expect(
        (await client.github("GET", `/repos/${org}/${repo}/invitations`, { token })).status,
      ).toBe(403);
      expect(
        (
          await client.github("PUT", `/repos/${org}/${repo}/collaborators/vera-viewer`, {
            token,
            json: { permission: "admin" },
          })
        ).status,
      ).toBe(403);
    }
  });
});
