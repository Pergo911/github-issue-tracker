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

test("a moved card does not snap back on refetch or refresh even with 60s Cache-Control headers", async ({
  page,
  world,
}) => {
  const title = tag();
  const { number } = await ownReport(world, title, [...KEPT, "status:new"]);
  const listResponses: { status: number; cacheControl: string | null }[] = [];
  page.on("response", (response) => {
    const pathname = new URL(response.url()).pathname;
    if (response.request().method() === "GET" && pathname.endsWith("/issues")) {
      listResponses.push({
        status: response.status(),
        cacheControl: response.headers()["cache-control"] ?? null,
      });
    }
  });

  await openBoard(page, "maintenance", title);
  await expect(inColumn(page, "new", number)).toBeVisible(SLOW);
  await expect.poll(() => listResponses.length, SLOW).toBeGreaterThanOrEqual(1);
  expect(listResponses[0]?.cacheControl).toBe("private, max-age=60, s-maxage=60");

  const beforeCount = listResponses.length;
  await card(page, title).getByRole("combobox").click();
  await page.getByRole("listbox").getByRole("option", { name: "Folyamatban" }).click();
  await expect(inColumn(page, "in-progress", number)).toBeVisible(SLOW);
  // Wait for the post-mutation invalidation refetch to complete from fake GitHub.
  await expect.poll(() => listResponses.length, SLOW).toBeGreaterThan(beforeCount);
  await expect(inColumn(page, "in-progress", number)).toBeVisible();
  await expect(inColumn(page, "new", number)).toHaveCount(0);

  // Manual Refresh within the 60s max-age window must still keep the updated column.
  const beforeRefresh = listResponses.length;
  await page.getByRole("button", { name: hu["reports.refresh"] }).click();
  await expect.poll(() => listResponses.length, SLOW).toBeGreaterThan(beforeRefresh);
  await expect(inColumn(page, "in-progress", number)).toBeVisible();
  await expect(inColumn(page, "new", number)).toHaveCount(0);
});

test("pending UX locks only the mutating card and concurrent moves on another card do not snap back", async ({
  page,
  world,
}) => {
  const run = tag();
  const owner = `own-${run}`;
  await staffToken(owner, "viewer");
  const cardA = await world.createReport({
    title: `${run}-A`,
    labels: [...KEPT, "status:new"],
    assignees: [owner],
  });
  const cardB = await world.createReport({
    title: `${run}-B`,
    labels: [...KEPT, "status:new"],
    assignees: [owner],
  });

  let patchAStarted = false;
  let patchBStarted = false;
  let releaseA!: () => void;
  let releaseB!: () => void;
  const gateA = new Promise<void>((resolve) => {
    releaseA = resolve;
  });
  const gateB = new Promise<void>((resolve) => {
    releaseB = resolve;
  });

  await page.route(new RegExp(`/issues/${cardA.number}$`), async (route) => {
    if (route.request().method() === "PATCH") {
      patchAStarted = true;
      await gateA;
    }
    return route.fallback();
  });
  await page.route(new RegExp(`/issues/${cardB.number}$`), async (route) => {
    if (route.request().method() === "PATCH") {
      patchBStarted = true;
      await gateB;
    }
    return route.fallback();
  });

  try {
    await openBoard(page, "maintenance", run);
    await expect(inColumn(page, "new", cardA.number)).toBeVisible(SLOW);
    await expect(inColumn(page, "new", cardB.number)).toBeVisible(SLOW);

    // Move Card A and hold its PATCH in flight.
    await card(page, `${run}-A`).getByRole("combobox").click();
    await page.getByRole("listbox").getByRole("option", { name: "Folyamatban" }).click();
    await expect.poll(() => patchAStarted, SLOW).toBe(true);

    const pendingCardA = inColumn(page, "in-progress", cardA.number);
    await expect(pendingCardA).toBeVisible(SLOW);
    await expect(pendingCardA).toHaveAttribute("aria-busy", "true");
    await expect(pendingCardA.locator("[data-grip]")).toBeDisabled();
    await expect(pendingCardA.getByRole("combobox")).toBeDisabled();
    await expect(pendingCardA.locator("[data-card-saving]")).toContainText(hu["board.card.saving"]);

    // Card B remains completely interactive while Card A saves.
    const readyCardB = inColumn(page, "new", cardB.number);
    await expect(readyCardB).not.toHaveAttribute("aria-busy", "true");
    await expect(readyCardB.locator("[data-grip]")).toBeEnabled();
    await expect(readyCardB.getByRole("combobox")).toBeEnabled();

    // Move Card B while Card A is still in flight.
    await readyCardB.getByRole("combobox").click();
    await page.getByRole("listbox").getByRole("option", { name: "Várakozik" }).click();
    await expect.poll(() => patchBStarted, SLOW).toBe(true);
    const pendingCardB = inColumn(page, "on-hold", cardB.number);
    await expect(pendingCardB).toBeVisible(SLOW);
    await expect(pendingCardB).toHaveAttribute("aria-busy", "true");

    // Finish Card A while Card B is still in flight: Card B must NOT snap back to "new".
    releaseA();
    await expect(pendingCardA).not.toHaveAttribute("aria-busy", "true", SLOW);
    await expect(pendingCardA).toBeVisible();
    await page.waitForTimeout(300);
    await expect(pendingCardB).toBeVisible();
    await expect(pendingCardB).toHaveAttribute("aria-busy", "true");
    await expect(inColumn(page, "new", cardB.number)).toHaveCount(0);

    // Finish Card B and verify both persist after settlement and manual refresh.
    releaseB();
    await expect(pendingCardB).not.toHaveAttribute("aria-busy", "true", SLOW);
    await page.getByRole("button", { name: hu["reports.refresh"] }).click();
    await expect(inColumn(page, "in-progress", cardA.number)).toBeVisible(SLOW);
    await expect(inColumn(page, "on-hold", cardB.number)).toBeVisible(SLOW);
  } finally {
    releaseA();
    releaseB();
  }
});
