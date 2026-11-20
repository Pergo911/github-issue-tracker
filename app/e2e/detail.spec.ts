import { hu } from "../src/shared/i18n/hu.ts";
import { urlFor } from "./support/servers.ts";
import { staffToken, startSignedIn } from "./support/staff.ts";
import { expect, test } from "./support/test.ts";
import { SLOW } from "./support/timings.ts";

// The Detail view (ticket #28), end to end against the real Worker and the fake GitHub: what each role sees, and a
// Status change through the real PATCH. The tests share the seeded world, so each names its own Report.

const tag = () => `detail-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

test("a Viewer reads the Report and can comment, but has no action controls", async ({
  page,
  world,
}) => {
  const title = tag();
  const { number } = await world.createReport({
    title,
    labels: ["category:elevator", "status:new"],
  });
  const { token } = await staffToken(`e2e-detail-viewer-${title}`, "viewer");
  await startSignedIn(page, token);
  await page.goto(urlFor("seeded", `/staff/reports/${number}`));
  await expect(page.getByRole("heading", { level: 1, name: new RegExp(title) })).toBeVisible(SLOW);
  await expect(page.locator("aside [role=combobox]")).toHaveCount(0);
  await expect(page.locator("form button:not([type=submit])")).toHaveCount(0);
  await expect(page.locator("#comment")).toBeVisible();

  await page.locator("#comment").fill(`hello-${title}`);
  await page.locator("form button[type=submit]").click();
  await expect(page.getByText(`hello-${title}`)).toBeVisible(SLOW);
});

test("Maintenance staff change the Status in one PATCH, repairing a doubled Status, and close the Report", async ({
  page,
  world,
}) => {
  const title = tag();
  const { number } = await world.createReport({
    title,
    labels: ["category:elevator", "priority:high", "status:new", "status:retired"],
  });
  const { token } = await staffToken(`e2e-detail-maint-${title}`, "maintenance");
  await startSignedIn(page, token);
  await page.goto(urlFor("seeded", `/staff/reports/${number}`));
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible(SLOW);
  // The warning is there, then gone after the repair.
  await expect(page.getByRole("status").first()).toBeVisible(SLOW);

  await page.locator("aside [role=combobox]").first().click();
  await page.getByRole("option", { name: "Folyamatban" }).click();
  await expect(page.locator("aside [role=combobox]").first()).toHaveText("Folyamatban", SLOW);
  await expect(page.getByText(hu["reports.statusProblem.multiple"])).toHaveCount(0);

  await page.locator("form button:not([type=submit])").click();
  await page.getByRole("dialog").getByRole("button").last().click();
  await expect(page.locator("[data-state-pill=fixed]")).toBeVisible(SLOW);
  await expect(page.getByRole("button", { name: hu["detail.reopen.button"] })).toBeVisible();
});
