import type { Page } from "@playwright/test";
import { hu } from "../src/shared/i18n/hu.ts";
import { buildReporterComment } from "../src/shared/reports/attribution.ts";
import { urlFor } from "./support/servers.ts";
import { staffToken, startSignedIn } from "./support/staff.ts";
import type { AsyncControl } from "../fakes/control.ts";
import { expect, test } from "./support/test.ts";

// The Board and the Reporter-comment scan (ticket #29), end to end against the real Worker and the fake GitHub.
// The tests share the seeded world, so each names its own Reports and finds them by title.

const tag = () => `board-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const SLOW = { timeout: 30_000 };
const KEPT = ["category:elevator", "priority:high", "extra:keep"];

const card = (page: Page, title: string) =>
  page.locator("[data-report]").filter({ hasText: title });
const column = (page: Page, id: string) => page.locator(`[data-column="${id}"]`);
/** A Report's card in a column; the drag library's hidden placeholder is not the card. */
const inColumn = (page: Page, id: string, number: number) =>
  column(page, id).locator(`[data-report="${number}"]:not([data-dnd-placeholder])`);

/** Every PATCH to one Report, as the labels it carried. */
function recordPatches(page: Page, number: number) {
  const patches: string[][] = [];
  page.on("request", (request) => {
    if (
      request.method() === "PATCH" &&
      new URL(request.url()).pathname.endsWith(`/issues/${number}`)
    ) {
      patches.push((request.postDataJSON() as { labels: string[] }).labels);
    }
  });
  return patches;
}

/** A Report of this test alone: assigned to its own member, so the Board can be filtered down to it. */
async function ownReport(world: AsyncControl, title: string, labels: string[]) {
  const owner = `own-${title}`;
  await staffToken(owner, "viewer");
  return world.createReport({ title, labels, assignees: [owner] });
}

async function openBoard(page: Page, role: "viewer" | "maintenance", who: string, query = "") {
  const { token } = await staffToken(`e2e-board-${role}-${who}`, role);
  await startSignedIn(page, token);
  await page.goto(urlFor("seeded", `/staff/reports?layout=board&assignee=own-${who}${query}`));
  await expect(page.locator("[data-board]")).toBeVisible(SLOW);
}

async function mouseDrag(
  page: Page,
  from: ReturnType<Page["locator"]>,
  to: ReturnType<Page["locator"]>,
) {
  const a = (await from.boundingBox())!;
  const b = (await to.boundingBox())!;
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(a.x + a.width / 2 + 10, a.y + a.height / 2 + 10, { steps: 3 });
  await page.mouse.move(b.x + b.width / 2, b.y + 60, { steps: 12 });
  await page.mouse.up();
}

test("a card moved by mouse drag sends exactly one PATCH and keeps the other labels", async ({
  page,
  world,
}) => {
  const title = tag();
  const { number } = await ownReport(world, title, [...KEPT, "status:new"]);
  const patches = recordPatches(page, number);
  await openBoard(page, "maintenance", title);
  await expect(inColumn(page, "new", number)).toBeVisible(SLOW);

  await mouseDrag(page, card(page, title).locator("[data-grip]"), column(page, "in-progress"));
  await expect(inColumn(page, "in-progress", number)).toBeVisible(SLOW);
  await expect.poll(() => patches.length, SLOW).toBe(1);
  expect(patches[0]?.sort()).toEqual([...KEPT, "status:in-progress"].sort());
  // Nothing else is written afterwards.
  await page.waitForTimeout(500);
  expect(patches).toHaveLength(1);
});

test("a card lifted and moved by keyboard sends exactly one PATCH", async ({ page, world }) => {
  const title = tag();
  const { number } = await ownReport(world, title, [...KEPT, "status:new"]);
  const patches = recordPatches(page, number);
  await openBoard(page, "maintenance", title);
  await expect(card(page, title)).toBeVisible(SLOW);

  const grip = card(page, title).locator("[data-grip]");
  await grip.focus();
  await page.keyboard.press("Space");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Space");
  await expect.poll(() => patches.length, SLOW).toBe(1);
  expect(patches[0]).toContain("extra:keep");
  expect(patches[0]?.filter((label) => label.startsWith("status:"))).toHaveLength(1);
  expect(patches[0]).not.toContain("status:new");
  await page.waitForTimeout(500);
  expect(patches).toHaveLength(1);
});

test("a card moved through its Status menu sends exactly one PATCH and keeps the other labels", async ({
  page,
  world,
}) => {
  const title = tag();
  const { number } = await ownReport(world, title, [...KEPT, "status:new"]);
  const patches = recordPatches(page, number);
  await openBoard(page, "maintenance", title);
  await expect(card(page, title)).toBeVisible(SLOW);

  await card(page, title).getByRole("combobox").click();
  await page.getByRole("listbox").getByRole("option", { name: "Folyamatban" }).click();
  await expect(inColumn(page, "in-progress", number)).toBeVisible(SLOW);
  await expect.poll(() => patches.length, SLOW).toBe(1);
  expect(patches[0]?.sort()).toEqual([...KEPT, "status:in-progress"].sort());
});

test("a failed PATCH puts the card back and says so", async ({ page, world }) => {
  const title = tag();
  const { number } = await ownReport(world, title, [...KEPT, "status:new"]);
  await page.route(new RegExp(`/issues/${number}$`), (route) => {
    if (route.request().method() !== "PATCH") return route.fallback();
    return route.fulfill({
      status: 500,
      contentType: "application/json",
      headers: { "access-control-allow-origin": "*" },
      body: JSON.stringify({ message: "boom" }),
    });
  });
  await openBoard(page, "maintenance", title);
  await expect(card(page, title)).toBeVisible(SLOW);

  await card(page, title).getByRole("combobox").click();
  await page.getByRole("listbox").getByRole("option", { name: "Folyamatban" }).click();
  await expect(page.getByRole("alert")).toContainText(String(number), SLOW);
  await expect(inColumn(page, "new", number)).toBeVisible();
  await expect(inColumn(page, "in-progress", number)).toHaveCount(0);
});

test("a Report with an invalid Status sits in the correction column and a move repairs it", async ({
  page,
  world,
}) => {
  const title = tag();
  const { number } = await ownReport(world, title, [...KEPT, "status:new", "status:retired"]);
  const patches = recordPatches(page, number);
  await openBoard(page, "maintenance", title);
  await expect(inColumn(page, "needs-correction", number)).toBeVisible(SLOW);

  await card(page, title).getByRole("combobox").click();
  await page.getByRole("listbox").getByRole("option", { name: "Folyamatban" }).click();
  await expect(inColumn(page, "in-progress", number)).toBeVisible(SLOW);
  await expect.poll(() => patches.length, SLOW).toBe(1);
  expect(patches[0]?.filter((label) => label.startsWith("status:"))).toEqual([
    "status:in-progress",
  ]);
  expect(patches[0]).toContain("extra:keep");
});

test("a Viewer sees the Board with no way to move a card", async ({ page, world }) => {
  const title = tag();
  await ownReport(world, title, [...KEPT, "status:new"]);
  await openBoard(page, "viewer", title);
  await expect(card(page, title)).toBeVisible(SLOW);
  await expect(page.locator("[data-grip]")).toHaveCount(0);
  await expect(page.locator("[data-board] [role=combobox]")).toHaveCount(0);
});

test("the Board/List toggle is part of the URL", async ({ page, world }) => {
  const title = tag();
  await ownReport(world, title, [...KEPT, "status:new"]);
  await openBoard(page, "maintenance", title);
  await page.getByRole("button", { name: hu["reports.layout.list"] }).click();
  await expect(page).not.toHaveURL(/layout=board/);
  await expect(page.locator("[data-board]")).toHaveCount(0);
  await page.getByRole("button", { name: hu["reports.layout.board"] }).click();
  await expect(page).toHaveURL(/layout=board/);
  await expect(page.locator("[data-board]")).toBeVisible();
});

test("the Reporter-comment filter and sort are right, and a refresh picks up a new comment", async ({
  page,
  world,
}) => {
  const run = tag();
  const labels = [...KEPT, "status:new"];
  const first = await world.createReport({ title: `${run}-first`, labels });
  const second = await world.createReport({ title: `${run}-second`, labels });
  const quiet = await world.createReport({ title: `${run}-quiet`, labels });
  const { login } = await staffToken(`e2e-board-author-${run}`, "maintenance");
  await world.addComment(first.number, buildReporterComment("első"));
  // The fake's clock stands still, so a later comment needs a later time.
  await world.advanceClock(60_000);
  await world.addComment(second.number, buildReporterComment("második"));
  // Not Reporter comments: a Staff comment and a Staff member's imitation of the envelope.
  await world.addComment(quiet.number, "Staff szó", login);
  await world.addComment(quiet.number, buildReporterComment("hamis"), login);

  const { token } = await staffToken(`e2e-board-list-${run}`, "viewer");
  await startSignedIn(page, token);
  await page.goto(urlFor("seeded", `/staff/reports?q=&reporter=1&sort=reporter`));
  const rows = page.locator("[data-report]").filter({ hasText: run });
  await expect(rows).toHaveCount(2, SLOW);
  // The latest Reporter comment first.
  await expect(rows.first()).toContainText(`${run}-second`);
  await expect(rows.last()).toContainText(`${run}-first`);
  await expect(page.locator(`[data-report="${quiet.number}"]`)).toHaveCount(0);

  await world.advanceClock(60_000);
  await world.addComment(first.number, buildReporterComment("újabb"));
  await page.getByRole("button", { name: hu["reports.refresh"] }).click();
  await expect(rows.first()).toContainText(`${run}-first`, SLOW);
  await expect(rows.first()).toContainText(hu["reports.reporter.mark"].replace("{count}", "2"));
});
