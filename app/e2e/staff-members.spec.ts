import type { Page } from "@playwright/test";
import { hu } from "../src/shared/i18n/hu.ts";
import { expectAccessible } from "./support/axe.ts";
import { controlUrl, urlFor } from "./support/servers.ts";
import { staffToken, startSignedIn } from "./support/staff.ts";
import { expect, test } from "./support/test.ts";

// The Staff screen (/staff/members, ticket #40, ADR 0006), end to end: the real Worker, the real
// role gate, and the fake GitHub. Tests share the seeded server's world, so each test tags its own
// GitHub accounts and never mutates world-wide settings.

const tag = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const githubBase = () => controlUrl("seeded").replace(/\/control$/, "/github");

const memberRow = (page: Page, login: string) => page.locator(`[data-staff-member="${login}"]`);
const invitationRow = (page: Page, login: string) =>
  page.locator(`[data-invitation-login="${login}"]`);

async function openMembers(page: Page, token: string) {
  await startSignedIn(page, token);
  await page.goto(urlFor("seeded", "/staff/members"));
  await expect(page.getByRole("heading", { level: 1, name: hu["members.title"] })).toBeVisible({
    timeout: 30_000,
  });
}

test.describe("the Staff screen (/staff/members)", () => {
  test("adds a GitHub Organization member immediately and sends, edits, and cancels an outside-account invitation", async ({
    page,
    world,
  }) => {
    const id = tag();
    const { token } = await staffToken(`e2e-sm-admin-${id}`, "admin");
    const orgLogin = `e2e-org-${id}`;
    const extLogin = `e2e-ext-${id}`;
    await world.addStaff({ login: orgLogin, role: "none", orgMember: true });
    await world.addStaff({ login: extLogin, role: "none", orgMember: false });

    await openMembers(page, token);

    // 1. Add an existing GitHub Organization member -> immediate access.
    await page.getByLabel(hu["members.add.username"]).fill(orgLogin);
    await page.getByLabel(hu["members.add.role"], { exact: true }).selectOption("maintenance");
    await page.getByRole("button", { name: hu["members.add.submit"] }).click();

    await expect(
      page.getByRole("status").filter({ hasText: hu["members.add.added.title"] }),
    ).toBeVisible();
    await expect(memberRow(page, orgLogin)).toContainText(hu["staff.role.maintenance"]);

    // 2. Add an outside GitHub account -> pending invitation.
    await page.getByLabel(hu["members.add.username"]).fill(extLogin);
    await page.getByLabel(hu["members.add.role"], { exact: true }).selectOption("viewer");
    await page.getByRole("button", { name: hu["members.add.submit"] }).click();

    await expect(
      page.getByRole("status").filter({ hasText: hu["members.add.invited.title"] }),
    ).toBeVisible();
    await expect(invitationRow(page, extLogin)).toContainText(hu["staff.role.viewer"]);

    // 3. Edit the pending invitation's role (Edit -> select -> Save; never auto-saves on change).
    await invitationRow(page, extLogin)
      .getByRole("button", { name: `${hu["members.invitations.edit"]}: ${extLogin}` })
      .click();
    await page
      .getByLabel(hu["members.invitations.roleLabel"].replace("{login}", extLogin))
      .selectOption("admin");
    // Cancel leaves the role unchanged:
    await invitationRow(page, extLogin)
      .getByRole("button", { name: hu["members.role.cancel"] })
      .click();
    await expect(invitationRow(page, extLogin)).toContainText(hu["staff.role.viewer"]);

    // Save updates it:
    await invitationRow(page, extLogin)
      .getByRole("button", { name: `${hu["members.invitations.edit"]}: ${extLogin}` })
      .click();
    await page
      .getByLabel(hu["members.invitations.roleLabel"].replace("{login}", extLogin))
      .selectOption("maintenance");
    await invitationRow(page, extLogin)
      .getByRole("button", { name: hu["members.role.save"] })
      .click();
    await expect(invitationRow(page, extLogin).locator("select")).toHaveCount(0);
    await expect(invitationRow(page, extLogin)).toContainText(hu["staff.role.maintenance"]);

    // 4. Cancel the pending invitation via inline danger confirmation.
    await invitationRow(page, extLogin)
      .getByRole("button", { name: `${hu["members.invitations.cancel"]}: ${extLogin}` })
      .click();
    await expect(
      page.getByText(hu["members.invitations.cancelTitle"].replace("{login}", extLogin)),
    ).toBeVisible();
    await invitationRow(page, extLogin)
      .getByRole("alert")
      .getByRole("button", { name: hu["members.invitations.cancelConfirm"], exact: true })
      .click();
    await expect(invitationRow(page, extLogin)).toHaveCount(0);

    await page.mouse.move(-1, -1);
    await expectAccessible(page);
  });

  test("changes an active member's role and removes them, immediately revoking access and unassigning open Reports", async ({
    page,
    world,
    request,
  }) => {
    const id = tag();
    const { token: adminToken } = await staffToken(`e2e-sm-edit-${id}`, "admin");
    const targetLogin = `e2e-target-${id}`;
    const target = await world.addStaff({ login: targetLogin, role: "triage" });

    const report = await world.createReport({
      title: `Assigned report ${id}`,
      labels: ["category:plumbing", "location:floor-1", "status:new"],
      assignees: [targetLogin],
    });

    await openMembers(page, adminToken);
    await expect(memberRow(page, targetLogin)).toContainText(hu["staff.role.maintenance"]);

    // Inline Edit -> select -> Save changes role (never auto-saves; Save stays disabled while unchanged).
    await memberRow(page, targetLogin)
      .getByRole("button", { name: `${hu["members.role.edit"]}: ${targetLogin}` })
      .click();
    await expect(
      memberRow(page, targetLogin).getByRole("button", { name: hu["members.role.save"] }),
    ).toBeDisabled();
    await page
      .getByLabel(hu["members.role.label"].replace("{login}", targetLogin))
      .selectOption("viewer");
    await expect(
      memberRow(page, targetLogin).getByRole("button", { name: hu["members.role.save"] }),
    ).toBeEnabled();
    await memberRow(page, targetLogin)
      .getByRole("button", { name: hu["members.role.cancel"] })
      .click();
    await expect(memberRow(page, targetLogin)).toContainText(hu["staff.role.maintenance"]);

    await memberRow(page, targetLogin)
      .getByRole("button", { name: `${hu["members.role.edit"]}: ${targetLogin}` })
      .click();
    await page
      .getByLabel(hu["members.role.label"].replace("{login}", targetLogin))
      .selectOption("admin");
    await memberRow(page, targetLogin)
      .getByRole("button", { name: hu["members.role.save"] })
      .click();
    await expect(memberRow(page, targetLogin).locator("select")).toHaveCount(0);
    await expect(memberRow(page, targetLogin)).toContainText(hu["staff.role.admin"]);

    // Inline Remove confirmation warns about immediate access loss & open Report unassignment.
    await memberRow(page, targetLogin)
      .getByRole("button", { name: `${hu["members.remove"]}: ${targetLogin}` })
      .click();
    const confirmAlert = memberRow(page, targetLogin).getByRole("alert");
    await expect(confirmAlert).toContainText(hu["members.remove.description"]);
    await confirmAlert.getByRole("button", { name: hu["members.remove.cancel"] }).click();
    await expect(memberRow(page, targetLogin)).toBeVisible();

    await memberRow(page, targetLogin)
      .getByRole("button", { name: `${hu["members.remove"]}: ${targetLogin}` })
      .click();
    await memberRow(page, targetLogin)
      .getByRole("button", { name: hu["members.remove.confirm"] })
      .click();
    await expect(memberRow(page, targetLogin)).toHaveCount(0);

    // Target's access ended immediately:
    const meta = await request.get(urlFor("seeded", "/api/staff/meta"), {
      headers: { authorization: `Bearer ${target.token}` },
    });
    expect(meta.status()).toBe(403);

    // Open Report is now unassigned on GitHub:
    const { org, repo } = await world.summary();
    const issue = await request.get(
      `${githubBase()}/repos/${org}/${repo}/issues/${report.number}`,
      {
        headers: {
          authorization: `Bearer ${adminToken}`,
          "x-github-api-version": "2022-11-28",
          "user-agent": "e2e",
        },
      },
    );
    expect((await issue.json()).assignees).toEqual([]);
  });

  test("protects self, inherited-only members, and the last active System admin, and warns on inherited override", async ({
    page,
    world,
  }) => {
    const id = tag();
    const selfLogin = `e2e-self-${id}`;
    const inheritedLogin = `e2e-inh-${id}`;
    const dualLogin = `e2e-dual-${id}`;
    const { token } = await staffToken(selfLogin, "admin");
    await world.addStaff({ login: inheritedLogin, role: "none", inheritedRole: "admin" });
    await world.addStaff({ login: dualLogin, role: "admin", inheritedRole: "triage" });

    await openMembers(page, token);

    // Self row has badge, explanation, and no edit/remove buttons:
    await expect(memberRow(page, selfLogin)).toContainText(hu["members.badge.self"]);
    await expect(memberRow(page, selfLogin)).toContainText(hu["members.guard.self"]);
    await expect(memberRow(page, selfLogin).getByRole("button")).toHaveCount(0);

    // Inherited-only row is read-only ("Managed in GitHub Organization"):
    await expect(memberRow(page, inheritedLogin)).toContainText(hu["members.badge.inherited"]);
    await expect(memberRow(page, inheritedLogin)).toContainText(hu["members.guard.inherited"]);
    await expect(memberRow(page, inheritedLogin).getByRole("button")).toHaveCount(0);

    // Downgrading dual-grant member to viewer triggers the post-write override warning:
    await memberRow(page, dualLogin)
      .getByRole("button", { name: `${hu["members.role.edit"]}: ${dualLogin}` })
      .click();
    await page
      .getByLabel(hu["members.role.label"].replace("{login}", dualLogin))
      .selectOption("viewer");
    await memberRow(page, dualLogin).getByRole("button", { name: hu["members.role.save"] }).click();
    await expect(
      page.getByRole("status").filter({ hasText: hu["members.override.downgrade.title"] }),
    ).toBeVisible();
    await expect(memberRow(page, dualLogin)).toContainText(hu["staff.role.maintenance"]);

    // Single-admin protection in UI (verified cleanly via route fixture):
    await page.route("**/api/staff/members", (route) =>
      route.request().method() === "GET"
        ? route.fulfill({
            json: {
              members: [{ login: selfLogin, role: "admin", managed: true, isSelf: true }],
              invitations: [],
            },
          })
        : route.continue(),
    );
    await page.reload();
    await expect(memberRow(page, selfLogin)).toContainText(hu["members.guard.selfAndLastAdmin"]);
    await expect(memberRow(page, selfLogin).getByRole("button")).toHaveCount(0);
  });

  test("shows the dedicated staff_permission_required notice for a stale token without disrupting other screens", async ({
    page,
    world,
  }) => {
    const id = tag();
    const stale = await world.addStaff({
      login: `e2e-stale-${id}`,
      role: "admin",
      hasAdminPermission: false,
    });

    await openMembers(page, stale.token);
    await expect(
      page.getByRole("alert").filter({ hasText: hu["members.permissionRequired.title"] }),
    ).toBeVisible();
    await expect(page.getByText(hu["members.permissionRequired.description"])).toBeVisible();
    await expectAccessible(page);

    // Reports, Allowlist, and Configuration still work normally:
    await page.getByRole("link", { name: hu["staff.nav.allowlist"], exact: true }).click();
    await expect(
      page.getByRole("heading", { level: 1, name: hu["allowlist.title"] }),
    ).toBeVisible();
    await page.getByRole("link", { name: hu["staff.nav.configuration"], exact: true }).click();
    await expect(page.getByRole("heading", { level: 1, name: hu["config.title"] })).toBeVisible();
    await page.getByRole("link", { name: hu["staff.nav.reports"], exact: true }).click();
    await expect(page.getByRole("heading", { level: 1, name: hu["reports.title"] })).toBeVisible();
  });
});
