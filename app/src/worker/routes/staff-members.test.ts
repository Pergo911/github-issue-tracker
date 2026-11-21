import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { TEST_ORG, TEST_REPO } from "@fakes/testing/constants.ts";
import { addToAllowlist, fakeClient, fakeWorld } from "../testing/world.ts";

// Staff role management endpoints (SPEC 2.4, ADR 0006, ticket #40), through the real Worker against
// the fake GitHub: System admin only, using caller.token (never reports-bot), enforcing self-modification,
// last-active-admin, inherited-only, override detection, and missing Administration permission (403).

const send = (method: string, path: string, token: string | undefined, body?: unknown) =>
  exports.default.fetch(`https://reports.test${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

function admin(login = "ada-admin") {
  return fakeWorld().control.addStaff({ login, role: "admin" }).token;
}

describe("role gating", () => {
  it("refuses unauthenticated, Viewer, and Maintenance staff on every Staff management endpoint", async () => {
    const maintenance = fakeWorld().control.addStaff({ login: "mate", role: "triage" }).token;
    const viewer = fakeWorld().control.addStaff({ login: "vera", role: "read" }).token;
    const requests: [string, string, unknown?][] = [
      ["GET", "/api/staff/members"],
      ["POST", "/api/staff/members", { username: "someone", role: "viewer" }],
      ["PUT", "/api/staff/members", { username: "someone", role: "maintenance" }],
      ["DELETE", "/api/staff/members?username=someone"],
      ["PATCH", "/api/staff/members/invitations", { invitationId: 1, role: "admin" }],
      ["DELETE", "/api/staff/members/invitations?invitationId=1"],
    ];
    for (const [method, path, body] of requests) {
      expect((await send(method, path, undefined, body)).status, `${method} ${path}`).toBe(401);
      expect((await send(method, path, viewer, body)).status, `${method} ${path}`).toBe(403);
      expect((await send(method, path, maintenance, body)).status, `${method} ${path}`).toBe(403);
    }
  });
});

describe("GET /api/staff/members", () => {
  it("lists direct and inherited-only active Staff, collapses Write/Maintain to maintenance, and includes pending invitations", async () => {
    const token = admin("ada-admin");
    fakeWorld().control.addStaff({ login: "vera-viewer", role: "read" });
    fakeWorld().control.addStaff({ login: "mate-triage", role: "triage" });
    fakeWorld().control.addStaff({ login: "walt-write", role: "write" });
    fakeWorld().control.addStaff({ login: "marta-maintain", role: "maintain" });
    fakeWorld().control.addStaff({ login: "org-owner", role: "none", inheritedRole: "admin" });
    fakeWorld().control.addStaff({ login: "team-tech", role: "none", inheritedRole: "write" });
    fakeWorld().control.addStaff({ login: "ext-bob", role: "none", orgMember: false });

    // Create a pending outside invitation so GET returns both sections.
    const invited = await send("POST", "/api/staff/members", token, {
      username: "ext-bob",
      role: "viewer",
    });
    expect(invited.status).toBe(200);

    const response = await send("GET", "/api/staff/members", token);
    expect(response.status).toBe(200);
    const body = await response.json<{
      members: { login: string; role: string; managed: boolean; isSelf: boolean }[];
      invitations: { id: number; login: string; role: string; invitedBy: string | null }[];
    }>();

    expect(body.members).toEqual([
      { login: "ada-admin", role: "admin", managed: true, isSelf: true },
      { login: "org-owner", role: "admin", managed: false, isSelf: false },
      { login: "marta-maintain", role: "maintenance", managed: true, isSelf: false },
      { login: "mate-triage", role: "maintenance", managed: true, isSelf: false },
      { login: "team-tech", role: "maintenance", managed: false, isSelf: false },
      { login: "walt-write", role: "maintenance", managed: true, isSelf: false },
      { login: "vera-viewer", role: "viewer", managed: true, isSelf: false },
    ]);
    expect(body.invitations).toEqual([
      expect.objectContaining({
        login: "ext-bob",
        role: "viewer",
        invitedBy: "ada-admin",
      }),
    ]);
  });

  it("returns staff_permission_required (403) when the token or App lacks Administration, while other admin endpoints keep working", async () => {
    const stale = fakeWorld().control.addStaff({
      login: "stale-admin",
      role: "admin",
      hasAdminPermission: false,
    }).token;

    const list = await send("GET", "/api/staff/members", stale);
    expect(list.status).toBe(403);
    expect(await list.json()).toEqual({ error: { code: "staff_permission_required" } });

    // Reports meta, Allowlist, and Configuration remain unaffected:
    expect((await send("GET", "/api/staff/meta", stale)).status).toBe(200);
    expect((await send("GET", "/api/staff/allowlist", stale)).status).toBe(200);
    expect((await send("GET", "/api/staff/config", stale)).status).toBe(200);
  });
});

describe("POST /api/staff/members", () => {
  it("adds a GitHub Organization member immediately (added), invites an outside account (invited), and validates errors", async () => {
    const token = admin("ada-admin");
    fakeWorld().control.addStaff({ login: "org-jane", role: "none", orgMember: true });
    fakeWorld().control.addStaff({ login: "ext-nora", role: "none", orgMember: false });

    // Invalid username syntax, including an Allowlist email address (must never reach GitHub!).
    await addToAllowlist("secret.reporter@example.hu", "Resident");
    const emailAttempt = await send("POST", "/api/staff/members", token, {
      username: "secret.reporter@example.hu",
      role: "viewer",
    });
    expect(emailAttempt.status).toBe(422);
    expect(await emailAttempt.json()).toEqual({ error: { code: "invalid_username" } });

    const badSyntax = await send("POST", "/api/staff/members", token, {
      username: "-bad--name-",
      role: "viewer",
    });
    expect(badSyntax.status).toBe(422);
    expect(await badSyntax.json()).toEqual({ error: { code: "invalid_username" } });

    // Nonexistent GitHub account -> 404 github_user_not_found.
    const missing = await send("POST", "/api/staff/members", token, {
      username: "no-such-github-account",
      role: "viewer",
    });
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: { code: "github_user_not_found" } });

    // Existing GitHub Organization member -> immediate access (204 from GitHub -> outcome: "added").
    const added = await send("POST", "/api/staff/members", token, {
      username: "  org-jane  ",
      role: "maintenance",
    });
    expect(added.status).toBe(200);
    expect(await added.json()).toEqual({
      outcome: "added",
      member: { login: "org-jane", role: "maintenance", managed: true, isSelf: false },
    });

    // Adding an existing active member is explicitly rejected with already_staff (409).
    const dupActive = await send("POST", "/api/staff/members", token, {
      username: "ORG-JANE",
      role: "admin",
    });
    expect(dupActive.status).toBe(409);
    expect(await dupActive.json()).toEqual({ error: { code: "already_staff" } });

    // Outside account -> GitHub invitation created (201 from GitHub -> outcome: "invited").
    const invited = await send("POST", "/api/staff/members", token, {
      username: "ext-nora",
      role: "viewer",
    });
    expect(invited.status).toBe(200);
    expect(await invited.json()).toMatchObject({
      outcome: "invited",
      invitation: { login: "ext-nora", role: "viewer", invitedBy: "ada-admin" },
    });

    // Re-inviting someone who already has a pending invitation -> already_invited (409).
    const dupInvite = await send("POST", "/api/staff/members", token, {
      username: "EXT-NORA",
      role: "admin",
    });
    expect(dupInvite.status).toBe(409);
    expect(await dupInvite.json()).toEqual({ error: { code: "already_invited" } });
  });
});

describe("PUT and DELETE /api/staff/members (role change, removal, guards, override detection)", () => {
  it("enforces last-admin guard: pending admin invitations do NOT count, inherited GitHub Organization Owners DO count", async () => {
    const token = admin("ada-admin");
    fakeWorld().control.addStaff({ login: "pending-admin", role: "none", orgMember: false });
    await send("POST", "/api/staff/members", token, { username: "pending-admin", role: "admin" });

    // With only ada-admin active (and one pending admin invitation), demoting or removing ada hits last_admin_required:
    const demoteSole = await send("PUT", "/api/staff/members", token, {
      username: "ada-admin",
      role: "maintenance",
    });
    expect(demoteSole.status).toBe(409);
    expect(await demoteSole.json()).toEqual({ error: { code: "last_admin_required" } });

    const removeSole = await send("DELETE", "/api/staff/members?username=ada-admin", token);
    expect(removeSole.status).toBe(409);
    expect(await removeSole.json()).toEqual({ error: { code: "last_admin_required" } });

    // Once an inherited GitHub Organization Owner is present, they DO count as an active admin, so self-modification now hits cannot_modify_self:
    fakeWorld().control.addStaff({ login: "org-owner", role: "none", inheritedRole: "admin" });
    const demoteSelf = await send("PUT", "/api/staff/members", token, {
      username: "ada-admin",
      role: "maintenance",
    });
    expect(demoteSelf.status).toBe(409);
    expect(await demoteSelf.json()).toEqual({ error: { code: "cannot_modify_self" } });

    const removeSelf = await send("DELETE", "/api/staff/members?username=ada-admin", token);
    expect(removeSelf.status).toBe(409);
    expect(await removeSelf.json()).toEqual({ error: { code: "cannot_modify_self" } });
  });

  it("blocks modifying or removing inherited-only members with inherited_member_readonly", async () => {
    const token = admin("ada-admin");
    fakeWorld().control.addStaff({ login: "org-owner", role: "none", inheritedRole: "admin" });
    fakeWorld().control.addStaff({ login: "team-tech", role: "none", inheritedRole: "triage" });

    const editOwner = await send("PUT", "/api/staff/members", token, {
      username: "org-owner",
      role: "viewer",
    });
    expect(editOwner.status).toBe(409);
    expect(await editOwner.json()).toEqual({ error: { code: "inherited_member_readonly" } });

    const removeTeam = await send("DELETE", "/api/staff/members?username=team-tech", token);
    expect(removeTeam.status).toBe(409);
    expect(await removeTeam.json()).toEqual({ error: { code: "inherited_member_readonly" } });
  });

  it("preserves Write/Maintain on no-op role save, overwrites only when actively changed, and removes a member unassigning open Reports", async () => {
    const token = admin("ada-admin");
    const walt = fakeWorld().control.addStaff({ login: "walt-write", role: "write" });
    const report = fakeWorld().control.createReport({
      title: "Assigned to Walt",
      assignees: ["walt-write"],
    });

    // A no-op save with the same dashboard role (`maintenance`) preserves the existing GitHub Write grant:
    const noop = await send("PUT", "/api/staff/members", token, {
      username: "walt-write",
      role: "maintenance",
    });
    expect(noop.status).toBe(200);
    expect(await noop.json()).toEqual({
      member: { login: "walt-write", role: "maintenance", managed: true, isSelf: false },
      overridden: false,
    });
    const afterNoop = await fakeClient().github(
      "GET",
      `/repos/${TEST_ORG}/${TEST_REPO}/collaborators/walt-write/permission`,
      { token },
    );
    expect(afterNoop.json.role_name).toBe("write");

    // Actively changing dashboard role to viewer overwrites Write with pull (read), and changing back writes triage:
    const toViewer = await send("PUT", "/api/staff/members", token, {
      username: "walt-write",
      role: "viewer",
    });
    expect(toViewer.status).toBe(200);
    expect(await toViewer.json()).toEqual({
      member: { login: "walt-write", role: "viewer", managed: true, isSelf: false },
      overridden: false,
    });
    const afterViewer = await fakeClient().github(
      "GET",
      `/repos/${TEST_ORG}/${TEST_REPO}/collaborators/walt-write/permission`,
      { token },
    );
    expect(afterViewer.json.role_name).toBe("read");

    const toMaintenance = await send("PUT", "/api/staff/members", token, {
      username: "walt-write",
      role: "maintenance",
    });
    expect(toMaintenance.status).toBe(200);
    const afterMaintenance = await fakeClient().github(
      "GET",
      `/repos/${TEST_ORG}/${TEST_REPO}/collaborators/walt-write/permission`,
      { token },
    );
    expect(afterMaintenance.json.role_name).toBe("triage");

    // Removing revokes access immediately and unassigns the open Report:
    const removed = await send("DELETE", "/api/staff/members?username=walt-write", token);
    expect(removed.status).toBe(200);
    expect(await removed.json()).toEqual({ removed: true, overridden: false, effectiveRole: null });

    expect((await send("GET", "/api/staff/meta", walt.token)).status).toBe(403);
    const issueAfter = await fakeClient().github(
      "GET",
      `/repos/${TEST_ORG}/${TEST_REPO}/issues/${report.number}`,
      { token },
    );
    expect(issueAfter.json.assignees).toEqual([]);
  });

  it("detects post-write overrides when an overlapping GitHub Organization or team grant keeps role higher or keeps access after removal", async () => {
    const token = admin("ada-admin");
    fakeWorld().control.addStaff({
      login: "dual-user",
      role: "admin",
      inheritedRole: "triage",
    });

    // Downgrading dual-user to viewer writes pull, but inherited triage keeps effective role at maintenance -> overridden: true.
    const downgraded = await send("PUT", "/api/staff/members", token, {
      username: "dual-user",
      role: "viewer",
    });
    expect(downgraded.status).toBe(200);
    expect(await downgraded.json()).toEqual({
      member: { login: "dual-user", role: "maintenance", managed: true, isSelf: false },
      overridden: true,
    });

    // Removing dual-user removes the direct grant, but inherited triage keeps access -> overridden: true, effectiveRole: "maintenance".
    const removed = await send("DELETE", "/api/staff/members?username=dual-user", token);
    expect(removed.status).toBe(200);
    expect(await removed.json()).toEqual({
      removed: true,
      overridden: true,
      effectiveRole: "maintenance",
    });
  });
});

describe("PATCH and DELETE /api/staff/members/invitations", () => {
  it("updates a pending invitation's role and cancels it, answering 404 when missing", async () => {
    const token = admin("ada-admin");
    fakeWorld().control.addStaff({ login: "ext-bob", role: "none", orgMember: false });

    const created = await (
      await send("POST", "/api/staff/members", token, { username: "ext-bob", role: "viewer" })
    ).json<{ outcome: "invited"; invitation: { id: number; role: string } }>();
    const id = created.invitation.id;

    const updated = await send("PATCH", "/api/staff/members/invitations", token, {
      invitationId: id,
      role: "maintenance",
    });
    expect(updated.status).toBe(200);
    expect(await updated.json()).toMatchObject({
      invitation: { id, login: "ext-bob", role: "maintenance" },
    });

    const cancelled = await send(
      "DELETE",
      `/api/staff/members/invitations?invitationId=${id}`,
      token,
    );
    expect(cancelled.status).toBe(200);
    expect(await cancelled.json()).toEqual({ cancelled: true });

    // Already cancelled -> 404 not_found.
    expect(
      (
        await send("PATCH", "/api/staff/members/invitations", token, {
          invitationId: id,
          role: "admin",
        })
      ).status,
    ).toBe(404);
    expect(
      (await send("DELETE", `/api/staff/members/invitations?invitationId=${id}`, token)).status,
    ).toBe(404);
  });
});
