import type { APIRequestContext, Page } from "@playwright/test";
import { en } from "../src/shared/i18n/en.ts";
import { hu } from "../src/shared/i18n/hu.ts";
import { expectAccessible } from "./support/axe.ts";
import { controlUrl, urlFor, type ServerKind } from "./support/servers.ts";
import { staffToken, startSignedIn } from "./support/staff.ts";
import { expect, test, worldOf } from "./support/test.ts";

// The Admin screens (ticket #30), end to end: the real Worker, the real role gate and the fake GitHub. The
// Allowlist journeys share the seeded server (they only add data under their own tag); the Configuration journeys
// run on the `setup` server, which starts as a fresh Deployment and which only they use.

const tag = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const githubOf = (kind: ServerKind) => controlUrl(kind).replace(/\/control$/, "/github");

async function repoLabels(
  request: APIRequestContext,
  kind: ServerKind,
  token: string,
): Promise<{ name: string; color: string }[]> {
  const { org, repo } = await worldOf(kind).summary();
  const response = await request.get(`${githubOf(kind)}/repos/${org}/${repo}/labels?per_page=100`, {
    headers: {
      authorization: `Bearer ${token}`,
      "x-github-api-version": "2022-11-28",
      "user-agent": "e2e",
    },
  });
  expect(response.status()).toBe(200);
  return response.json();
}

test.describe("the Allowlist screen", () => {
  async function openAllowlist(page: Page, login: string) {
    const { token } = await staffToken(login, "admin");
    await startSignedIn(page, token);
    await page.goto(urlFor("seeded", "/staff/allowlist"));
    await expect(page.getByRole("heading", { level: 1, name: hu["allowlist.title"] })).toBeVisible({
      timeout: 30_000,
    });
  }
  const entry = (page: Page, email: string) => page.locator(`[data-allowlist-entry="${email}"]`);

  test("bulk add with mixed lines reports each refused line, and the good ones are listed", async ({
    page,
    world,
  }) => {
    const id = tag();
    const good = `bulk-good-${id}@example.hu`;
    const noted = `bulk-noted-${id}@example.hu`;
    await world.protectEmail(good);
    await world.protectEmail(noted);
    await openAllowlist(page, "e2e-allow-bulk");
    await page
      .getByLabel(hu["allowlist.bulk.label"])
      .fill(
        [good.toUpperCase(), "", "this is not an address", `${noted} Kiss Anna, 2/5`, good].join(
          "\n",
        ),
      );
    await page.getByRole("button", { name: hu["allowlist.bulk.submit"] }).click();

    const result = page.getByRole("status").filter({ hasText: hu["allowlist.bulk.result.title"] });
    await expect(result).toContainText(
      hu["allowlist.bulk.result.summary"].replace("{added}", "2").replace("{refused}", "2"),
    );
    const errors = result.locator("[data-bulk-errors] li");
    await expect(errors).toHaveCount(2);
    await expect(errors.nth(0)).toContainText(
      `${hu["allowlist.bulk.result.line"].replace("{line}", "3").replace("{text}", "this is not an address")} — ${hu["allowlist.bulk.error.invalid_email"]}`,
    );
    await expect(errors.nth(1)).toContainText(hu["allowlist.bulk.error.duplicate"]);

    await expect(entry(page, good)).toBeVisible();
    await expect(entry(page, noted)).toContainText("Kiss Anna, 2/5");
    // The pointer is still on the button that was pressed; Primer's dark hover colour is not what is checked here.
    await page.mouse.move(-1, -1);
    await expectAccessible(page);
  });

  test("edits a note and removes an entry after a confirmation; a removed address no longer gets a code", async ({
    page,
    world,
    request,
  }) => {
    const id = tag();
    const keeper = `keeper-${id}@example.hu`;
    const leaver = `leaver-${id}@example.hu`;
    await world.protectEmail(keeper);
    await world.protectEmail(leaver);
    await openAllowlist(page, "e2e-allow-edit");
    await page.getByLabel(hu["allowlist.bulk.label"]).fill(`${keeper} first\n${leaver} leaving`);
    await page.getByRole("button", { name: hu["allowlist.bulk.submit"] }).click();
    await expect(entry(page, leaver)).toBeVisible();

    // Edit a note.
    await entry(page, keeper)
      .getByRole("button", { name: `${hu["allowlist.note.edit"]}: ${keeper}` })
      .click();
    await page.getByLabel(hu["allowlist.note.label"].replace("{email}", keeper)).fill("second");
    await page.getByRole("button", { name: hu["allowlist.note.save"] }).click();
    await expect(entry(page, keeper)).toContainText("second");
    await expect(entry(page, keeper)).not.toContainText("first");

    // Removal asks first, and keeping the entry changes nothing.
    await entry(page, leaver)
      .getByRole("button", { name: `${hu["allowlist.remove"]}: ${leaver}` })
      .click();
    await expect(
      page.getByText(hu["allowlist.remove.title"].replace("{email}", leaver)),
    ).toBeVisible();
    await page.getByRole("button", { name: hu["allowlist.remove.cancel"] }).click();
    await expect(entry(page, leaver)).toBeVisible();
    await entry(page, leaver)
      .getByRole("button", { name: `${hu["allowlist.remove"]}: ${leaver}` })
      .click();
    await page.getByRole("button", { name: hu["allowlist.remove.confirm"] }).click();
    await expect(entry(page, leaver)).toHaveCount(0);

    // The listed address gets a code, the removed one does not (the answer is the same either way).
    const ask = (email: string, ip: string) =>
      request.post(urlFor("seeded", "/api/reports/code"), {
        data: { email },
        headers: { "x-dev-client-ip": ip },
      });
    expect((await ask(keeper, `10.30.0.${Math.floor(Math.random() * 200) + 1}`)).status()).toBe(
      200,
    );
    await expect.poll(async () => (await world.latestMailTo(keeper))?.subject).toBeTruthy();
    expect((await ask(leaver, `10.31.0.${Math.floor(Math.random() * 200) + 1}`)).status()).toBe(
      200,
    );
    expect(await world.latestMailTo(leaver)).toBeNull();
  });

  test("search narrows the list, and the note about the delay is on the screen", async ({
    page,
    world,
  }) => {
    const id = tag();
    const email = `findme-${id}@example.hu`;
    await world.protectEmail(email);
    await openAllowlist(page, "e2e-allow-search");
    await expect(page.getByText(hu["allowlist.intro"])).toBeVisible();
    await page.getByLabel(hu["allowlist.add.email"]).fill(email);
    await page.getByLabel(hu["allowlist.add.note"]).fill("Needle Note");
    await page.getByRole("button", { name: hu["allowlist.add.submit"] }).click();
    await expect(entry(page, email)).toBeVisible();
    await page.getByLabel(hu["allowlist.search.label"]).fill("needle");
    await expect(page.locator("[data-allowlist-entry]")).toHaveCount(1);
    await page.getByLabel(hu["allowlist.search.label"]).fill("no-such-thing-anywhere");
    await expect(page.getByText(hu["allowlist.noMatches"])).toBeVisible();
  });
});

test.describe("who can reach the Admin screens", () => {
  test("Maintenance staff and Viewers have no links, are sent back from the URLs, and are refused by the API", async ({
    page,
    request,
  }) => {
    for (const role of ["maintenance", "viewer"] as const) {
      const { token } = await staffToken(`e2e-nonadmin-${role}`, role);
      const refused = await request.get(urlFor("seeded", "/api/staff/allowlist"), {
        headers: { authorization: `Bearer ${token}` },
      });
      expect(refused.status()).toBe(403);
      const refusedConfig = await request.get(urlFor("seeded", "/api/staff/config"), {
        headers: { authorization: `Bearer ${token}` },
      });
      expect(refusedConfig.status()).toBe(403);
    }
    const { token } = await staffToken("e2e-nonadmin-page", "maintenance");
    await startSignedIn(page, token);
    for (const path of ["/staff/allowlist", "/staff/configuration"]) {
      await page.goto(urlFor("seeded", path));
      await expect(page.getByRole("heading", { level: 1, name: hu["reports.title"] })).toBeVisible({
        timeout: 30_000,
      });
      await expect(page).toHaveURL(/\/staff\/reports/);
    }
    for (const name of [hu["staff.nav.allowlist"], hu["staff.nav.configuration"]]) {
      await expect(page.getByRole("link", { name, exact: true })).toHaveCount(0);
    }
  });
});

test.describe.serial("a fresh Deployment, set up from empty and then edited", () => {
  const setup = () => worldOf("setup");
  let adminToken = "";

  async function openConfiguration(page: Page, section?: string) {
    await startSignedIn(page, adminToken);
    await page.goto(urlFor("setup", `/staff/configuration${section ? `?section=${section}` : ""}`));
  }
  const saveButton = (page: Page, text: typeof en | typeof hu = en) =>
    page.getByRole("button", { name: text["config.save"] });
  const region = (page: Page, name: string) => page.getByRole("region", { name });

  test.beforeAll(async () => {
    adminToken = (await setup().addStaff({ login: "setup-admin", role: "admin" })).token;
  });

  test("other roles are told it is not configured", async ({ page }) => {
    const { token } = await setup().addStaff({ login: "setup-maintenance", role: "triage" });
    await startSignedIn(page, token);
    await page.goto(urlFor("setup", "/staff"));
    await expect(
      page.getByRole("heading", { level: 1, name: en["staff.notConfigured.title"] }),
    ).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("link", { name: en["staff.nav.configuration"] })).toHaveCount(0);
  });

  test("a System admin who signs in lands on the Configuration screen, pre-filled; an invalid first save names the fields", async ({
    page,
    request,
  }) => {
    await startSignedIn(page, adminToken);
    await page.goto(urlFor("setup", "/staff"));
    await expect(page.getByRole("heading", { level: 1, name: en["config.title"] })).toBeVisible({
      timeout: 30_000,
    });
    await expect(page).toHaveURL(/\/staff\/configuration/);
    await expect(page.getByText(en["config.fresh.title"])).toBeVisible();
    // Nothing else is offered yet.
    await expect(
      page.getByRole("link", { name: en["staff.nav.reports"], exact: true }),
    ).toHaveCount(0);

    // The starter configuration lacks the two names only the Organization can supply.
    await saveButton(page).click();
    await expect(
      page.getByRole("alert").filter({ hasText: en["config.invalid.title"] }),
    ).toBeVisible();
    await expect(page.locator("#displayName")).toHaveAttribute("aria-invalid", "true");
    await expect(page.getByText(en["config.error.required"]).first()).toBeVisible();
    await expectAccessible(page);
    expect(
      (await request.get(urlFor("setup", "/api/config/public"))).status(),
      "a refused save writes nothing",
    ).toBe(404);
  });

  test("the first valid save creates the configuration and its labels, and the app comes alive", async ({
    page,
    request,
  }) => {
    await openConfiguration(page);
    await page.locator("#displayName").fill("Setup Társasház");
    await page.getByRole("link", { name: en["config.section.email"] }).click();
    await page.locator("#senderName").fill("Setup Társasház");
    await page.locator("#replyTo").fill("gondnok@example.org");
    await saveButton(page).click();

    // After a first save the admin is taken to the Reports, now that there is something to show.
    await expect(page.getByRole("heading", { level: 1, name: en["reports.title"] })).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByRole("banner").getByText("Setup Társasház")).toBeVisible();
    const publicConfig = await request.get(urlFor("setup", "/api/config/public"));
    expect(publicConfig.status()).toBe(200);
    expect((await publicConfig.json()).displayName).toBe("Setup Társasház");

    const labels = await repoLabels(request, "setup", adminToken);
    expect(labels.find((label) => label.name === "category:general")?.color).toBe("cfd3d7");
    expect(labels.find((label) => label.name === "status:new")?.color).toBe("1d76db");
  });

  test("editing the Taxonomy creates and recolours labels, never deleting any, with a live pill preview", async ({
    page,
    request,
  }) => {
    await openConfiguration(page, "taxonomy");
    const categories = region(page, en["config.dimension.category"]);
    await expect(categories).toBeVisible({ timeout: 30_000 });

    // Recolour the saved value: its pill follows what is typed, and its identifier is fixed.
    const general = categories.locator('[data-taxonomy-value="category:general"]');
    await expect(general.getByLabel(en["config.value.id"])).toHaveAttribute("readonly", "");
    await general.getByLabel(en["config.value.color"]).fill("00ff00");
    const green = await general
      .locator("[data-label-pill]")
      .evaluate((pill) => getComputedStyle(pill).getPropertyValue("--label-g"));
    expect(green).toBe("255");

    // Add a value: the identifier follows the display name.
    await categories.getByRole("button", { name: en["config.value.add"] }).click();
    const added = categories.getByRole("listitem").last();
    await added.getByLabel(en["config.value.name"]).fill("Pest control");
    await expect(added.getByLabel(en["config.value.id"])).toHaveValue("pest-control");
    await added.getByLabel(en["config.value.color"]).fill("123456");
    await saveButton(page).click();

    await expect(
      page.getByRole("status").filter({ hasText: en["config.saved.title"] }),
    ).toContainText(en["config.saved.sync"].replace("{created}", "1").replace("{recoloured}", "1"));
    const labels = await repoLabels(request, "setup", adminToken);
    expect(labels.find((label) => label.name === "category:pest-control")?.color).toBe("123456");
    expect(labels.find((label) => label.name === "category:general")?.color).toBe("00ff00");

    // Removing a saved value warns, and the label stays on GitHub.
    await added.getByRole("button", { name: new RegExp(en["config.value.remove"]) }).click();
    // (the new value is saved now, so the warning is shown)
    await expect(
      page.getByText(en["config.value.removeWarning"].replace("{name}", "Pest control")),
    ).toBeVisible();
    await page.getByRole("button", { name: en["config.value.removeConfirm"] }).click();
    await saveButton(page).click();
    await expect(
      page.getByRole("status").filter({ hasText: en["config.saved.title"] }),
    ).toBeVisible();
    const after = await repoLabels(request, "setup", adminToken);
    expect(after.some((label) => label.name === "category:pest-control")).toBe(true);
  });

  test("exactly one Status is initial, and the initial one cannot be removed", async ({ page }) => {
    await openConfiguration(page, "taxonomy");
    const statuses = region(page, en["config.dimension.status"]);
    await expect(statuses).toBeVisible({ timeout: 30_000 });
    const radios = statuses.getByRole("radio", { name: en["config.value.status.initial"] });
    await expect(radios).toHaveCount(2);
    await expect(radios.nth(0)).toBeChecked();
    await expect(
      statuses.getByRole("button", { name: new RegExp(`${en["config.value.remove"]}: `) }).first(),
    ).toBeDisabled();
    await radios.nth(1).check();
    await expect(radios.nth(0)).not.toBeChecked();
    await expect(
      statuses.getByRole("button", { name: new RegExp(`${en["config.value.remove"]}: `) }).first(),
    ).toBeEnabled();
  });

  test("an invalid save is rejected with field errors in place, and nothing changes", async ({
    page,
    request,
  }) => {
    await openConfiguration(page, "taxonomy");
    const priorities = region(page, en["config.dimension.priority"]);
    await expect(priorities).toBeVisible({ timeout: 30_000 });
    // A new value whose identifier repeats an existing one, with a colour that is not hex. (Saved identifiers
    // are fixed, so the new value is where a duplicate can be typed.)
    await priorities.getByRole("button", { name: en["config.value.add"] }).click();
    const second = priorities.getByRole("listitem").last();
    await second.getByLabel(en["config.value.name"]).fill("Another");
    await second.getByLabel(en["config.value.id"]).fill("low");
    await second.getByLabel(en["config.value.color"]).fill("not-a-colour");
    await saveButton(page).click();

    await expect(
      page.getByRole("alert").filter({ hasText: en["config.invalid.title"] }),
    ).toBeVisible();
    await expect(second).toContainText(en["config.error.duplicate"]);
    await expect(second).toContainText(en["config.error.colour"]);
    await expect(
      page.getByRole("link", { name: new RegExp(en["config.section.taxonomy"]) }),
    ).toContainText(en["config.section.problems"].replace("{count}", "2"));
    await page.mouse.move(-1, -1);
    await expectAccessible(page);

    const stored = await (
      await request.get(urlFor("setup", "/api/staff/config"), {
        headers: { authorization: `Bearer ${adminToken}` },
      })
    ).json();
    expect(stored.config.taxonomy.priority.map((value: { id: string }) => value.id)).toEqual([
      "low",
      "normal",
      "high",
    ]);
  });

  test("switching the UI Language changes the UI", async ({ page }) => {
    await openConfiguration(page, "system");
    await expect(page.getByRole("heading", { level: 1, name: en["config.title"] })).toBeVisible({
      timeout: 30_000,
    });
    await page.getByLabel(en["config.language.label"]).selectOption("hu");
    await page.getByLabel(en["config.timezone.label"]).fill("Europe/Budapest");
    await saveButton(page).click();

    await expect(page.getByRole("heading", { level: 1, name: hu["config.title"] })).toBeVisible();
    await expect(
      page.getByRole("link", { name: hu["staff.nav.reports"], exact: true }),
    ).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("lang", "hu");
    await expect(saveButton(page, hu)).toBeVisible();
  });
});
