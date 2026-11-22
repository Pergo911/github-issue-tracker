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

test("comments, sidebar edits, List navigation, and Detail Refresh stay fresh within the 60s cache window", async ({
  page,
  world,
}) => {
  const title = tag();
  const { number } = await world.createReport({
    title,
    labels: ["category:elevator", "location:stairwell", "priority:low", "status:new"],
  });
  const { login, token } = await staffToken(`e2e-detail-cache-${title}`, "maintenance");

  const issueGets: { status: number; cacheControl: string | null }[] = [];
  const timelineGets: { status: number; cacheControl: string | null }[] = [];
  page.on("response", (response) => {
    if (response.request().method() !== "GET") return;
    const pathname = new URL(response.url()).pathname;
    if (pathname.endsWith(`/issues/${number}`)) {
      issueGets.push({
        status: response.status(),
        cacheControl: response.headers()["cache-control"] ?? null,
      });
    } else if (pathname.endsWith(`/issues/${number}/timeline`)) {
      timelineGets.push({
        status: response.status(),
        cacheControl: response.headers()["cache-control"] ?? null,
      });
    }
  });

  await startSignedIn(page, token);
  await page.goto(urlFor("seeded", `/staff/reports/${number}`));
  await expect(page.getByRole("heading", { level: 1, name: new RegExp(title) })).toBeVisible(SLOW);
  expect(issueGets[0]?.cacheControl).toBe("private, max-age=60, s-maxage=60");
  expect(timelineGets[0]?.cacheControl).toBe("private, max-age=60, s-maxage=60");

  // Edit Category in the sidebar and post a comment; both reflect immediately in Detail.
  const categoryPicker = page.getByRole("combobox", { name: hu["status.sidebar.category"] });
  await categoryPicker.click();
  await page.getByRole("option", { name: "Víz- és csatornahiba" }).click();
  await expect(categoryPicker).toHaveText("Víz- és csatornahiba", SLOW);

  const firstComment = `comment-${title}`;
  await page.locator("#comment").fill(firstComment);
  await page.locator("form button[type=submit]").click();
  await expect(page.getByText(firstComment)).toBeVisible(SLOW);

  // Return to List inside the SPA (within the 60s cache window) and verify the updated Category pill shows.
  await page.getByRole("link", { name: hu["detail.back"] }).click();
  const row = page.locator(`[data-report="${number}"]`);
  await expect(row).toBeVisible(SLOW);
  await expect(row).toContainText("Víz- és csatornahiba", SLOW);

  // Navigate back to Detail, add an external comment via world, and fetch it with Detail Refresh.
  await row.locator("[data-report-title]").click();
  await expect(page.getByText(firstComment)).toBeVisible(SLOW);

  const externalComment = `external-${title}`;
  await world.addComment(number, externalComment, login);
  const refreshButton = page.getByRole("button", { name: hu["reports.refresh"] });
  await refreshButton.click();
  await expect(page.getByText(externalComment)).toBeVisible(SLOW);

  // Clicking Refresh again with no changes uses ETag / 304 seamlessly.
  const beforeIssueGets = issueGets.length;
  const beforeTimelineGets = timelineGets.length;
  await refreshButton.click();
  await expect.poll(() => issueGets.length, SLOW).toBeGreaterThan(beforeIssueGets);
  await expect.poll(() => timelineGets.length, SLOW).toBeGreaterThan(beforeTimelineGets);
  expect(issueGets.slice(beforeIssueGets).some((entry) => entry.status === 304)).toBe(true);
  expect(timelineGets.slice(beforeTimelineGets).some((entry) => entry.status === 304)).toBe(true);
  await expect(page.getByText(externalComment)).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("optimistic sidebar edit shows saving indicator next to that heading and rolls back cleanly on error", async ({
  page,
  world,
}) => {
  const title = tag();
  const { number } = await world.createReport({
    title,
    labels: ["category:elevator", "location:stairwell", "priority:low", "status:new"],
  });
  const { token } = await staffToken(`e2e-detail-rollback-${title}`, "maintenance");

  let patchStarted = false;
  let releasePatch!: () => void;
  const gate = new Promise<void>((resolve) => {
    releasePatch = resolve;
  });

  await page.route(new RegExp(`/issues/${number}$`), async (route) => {
    if (route.request().method() === "PATCH") {
      patchStarted = true;
      await gate;
      return route.fulfill({
        status: 500,
        contentType: "application/json",
        headers: { "access-control-allow-origin": "*" },
        body: JSON.stringify({ message: "boom" }),
      });
    }
    return route.fallback();
  });

  try {
    await startSignedIn(page, token);
    await page.goto(urlFor("seeded", `/staff/reports/${number}`));
    await expect(page.getByRole("heading", { level: 1, name: new RegExp(title) })).toBeVisible(
      SLOW,
    );

    const categoryPicker = page.getByRole("combobox", { name: hu["status.sidebar.category"] });
    await categoryPicker.click();
    await page.getByRole("option", { name: "Elektromos hiba" }).click();

    // Optimistic value stays visible immediately while saving, with inline indicator next to Category only.
    await expect.poll(() => patchStarted, SLOW).toBe(true);
    await expect(categoryPicker).toHaveText("Elektromos hiba");
    await expect(page.locator("[data-sidebar-saving]")).toHaveCount(1);
    await expect(page.locator("[data-sidebar-saving]")).toContainText(hu["detail.sidebar.saving"]);

    releasePatch();
    await expect(page.getByRole("alert")).toContainText(hu["detail.error.write"], SLOW);
    await expect(page.locator("[data-sidebar-saving]")).toHaveCount(0);
    await expect(categoryPicker).toHaveText("Lift");
  } finally {
    releasePatch();
  }
});

test("editing a dimension on a closed Report does not flip the Reopen button to Reopening", async ({
  page,
  world,
}) => {
  const title = tag();
  const { number } = await world.createReport({
    title,
    state: "closed",
    stateReason: "completed",
    labels: ["category:elevator", "location:stairwell", "priority:low"],
  });
  const { token } = await staffToken(`e2e-detail-closed-${title}`, "maintenance");

  let patchStarted = false;
  let releasePatch!: () => void;
  const gate = new Promise<void>((resolve) => {
    releasePatch = resolve;
  });

  await page.route(new RegExp(`/issues/${number}$`), async (route) => {
    if (route.request().method() === "PATCH") {
      patchStarted = true;
      await gate;
    }
    return route.fallback();
  });

  try {
    await startSignedIn(page, token);
    await page.goto(urlFor("seeded", `/staff/reports/${number}`));
    await expect(page.getByRole("button", { name: hu["detail.reopen.button"] })).toBeVisible(SLOW);

    const categoryPicker = page.getByRole("combobox", { name: hu["status.sidebar.category"] });
    await categoryPicker.click();
    await page.getByRole("option", { name: "Elektromos hiba" }).click();
    await expect.poll(() => patchStarted, SLOW).toBe(true);

    await expect(page.locator("[data-sidebar-saving]")).toHaveCount(1);
    await expect(page.getByRole("button", { name: hu["detail.reopen.button"] })).toBeVisible();
    await expect(page.getByText(hu["detail.reopen.reopening"])).toHaveCount(0);

    releasePatch();
    await expect(page.locator("[data-sidebar-saving]")).toHaveCount(0, SLOW);
    await expect(categoryPicker).toHaveText("Elektromos hiba");
    await expect(page.getByRole("button", { name: hu["detail.reopen.button"] })).toBeVisible();
  } finally {
    releasePatch();
  }
});
