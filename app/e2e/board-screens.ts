import { expect, type Page } from "@playwright/test";
import { buildReporterComment } from "../src/shared/reports/attribution.ts";
import type { Screen } from "./screens.ts";
import { staffData } from "./staff-screens.ts";
import {
  issuePayload,
  respond,
  serveReports,
  staffToken,
  startSignedIn,
  type IssueFixture,
} from "./support/staff.ts";
import { worldOf } from "./support/test.ts";

// The Board screens of ticket #29, declared for screenshots, reference images, axe and the pseudo-language sweep
// (see the note at the top of screens.ts). Sign-in and the role check go through the real Worker and the fake
// GitHub; the Reports, the repo-wide comments and the failing PATCH are fixed with `page.route` so every run looks
// the same. Ages are counted from 2026-06-15 12:00 UTC (see `serveReports`).

const fixtures: IssueFixture[] = [
  {
    number: 44,
    title: "Csöpög a csap a 2. emeleti közös mosdóban",
    labels: ["category:plumbing", "location:floor-2", "priority:high", "status:new"],
    createdAt: "2026-06-10T14:15:00Z",
  },
  {
    number: 46,
    title: "Hideg a radiátor az 1. emeleten",
    labels: ["category:heating-cooling", "location:floor-1", "priority:normal", "status:new"],
    createdAt: "2026-06-12T07:45:00Z",
  },
  {
    number: 41,
    title: "Beragadt a lift ajtaja",
    labels: ["category:elevator", "location:elevator", "priority:urgent", "status:in-progress"],
    assignees: ["screen-maintenance"],
    createdAt: "2026-06-01T08:00:00Z",
  },
  {
    number: 38,
    title: "Nem működik a lépcsőházi világítás",
    labels: ["category:electrical", "location:stairwell", "priority:high", "status:in-progress"],
    assignees: ["screen-maintenance"],
    createdAt: "2026-05-20T09:30:00Z",
  },
  {
    number: 42,
    title: "Lepereg a festék a tetőn",
    labels: ["category:legacy-paint", "location:roof", "status:retired"],
    createdAt: "2026-06-08T10:00:00Z",
  },
  {
    number: 40,
    title: "Repedt fal a pincelejáratnál",
    labels: ["category:structural", "location:basement", "status:new", "status:in-progress"],
    createdAt: "2026-06-03T11:00:00Z",
  },
  {
    number: 36,
    title: "Megjavították a kapucsengőt",
    labels: ["category:electrical", "location:ground-floor", "priority:normal"],
    state: "closed",
    stateReason: "completed",
    createdAt: "2026-05-02T09:00:00Z",
  },
];
const titles = fixtures.map((fixture) => fixture.title);
const allowText = [...titles, ...staffData];

const SLOW = { timeout: 30_000 };
const CORS = { "access-control-allow-origin": "*" };

type Role = "viewer" | "maintenance";

/** The Bot's Reporter comments on three Reports: #41 twice (the later one the latest of all), #44 and #38. */
async function reporterComments() {
  const bot = (await worldOf("seeded").summary()).bot;
  const user = { login: bot.login, id: bot.accountId, type: "Bot" };
  const comment = (issue: number, text: string, created_at: string) => ({
    id: issue * 100 + text.length,
    issue_url: `https://api.github.com/repos/o/r/issues/${issue}`,
    body: buildReporterComment(text),
    created_at,
    user,
  });
  return [
    comment(44, "Ma reggel is csöpög.", "2026-06-11T08:00:00Z"),
    comment(38, "Este sötét a lépcsőházban.", "2026-06-13T20:00:00Z"),
    comment(41, "Egy gyerek bent rekedt.", "2026-06-14T07:00:00Z"),
    comment(41, "Köszönöm a gyors választ.", "2026-06-14T09:00:00Z"),
  ];
}

interface Options {
  /** `hold`: the comments never arrive (the scan stays loading). */
  comments?: "serve" | "hold";
  /** Every PATCH of a Report fails. */
  failPatch?: boolean;
}

function signedIn(role: Role, options: Options = {}) {
  return async (page: Page) => {
    const { token } = await staffToken(`screen-${role}`, role);
    await startSignedIn(page, token);
    await serveReports(page, fixtures);
    const comments = await reporterComments();
    await page.route(/\/repos\/[^/]+\/[^/]+\/issues\/comments\?/, (route) => {
      if (options.comments === "hold" && route.request().method() === "GET") return;
      return respond(route, comments);
    });
    if (options.failPatch) {
      await page.route(/\/repos\/[^/]+\/[^/]+\/issues\/\d+$/, (route) => {
        const request = route.request();
        if (request.method() === "PATCH") {
          return route.fulfill({
            status: 500,
            contentType: "application/json",
            headers: CORS,
            body: JSON.stringify({ message: "Server Error" }),
          });
        }
        const number = Number(new URL(request.url()).pathname.split("/").at(-1));
        const fixture = fixtures.find((candidate) => candidate.number === number);
        return fixture ? respond(route, issuePayload(fixture)) : route.fallback();
      });
    }
  };
}

const boardShown = async (page: Page) => {
  await expect(page.locator("[data-board]")).toBeVisible(SLOW);
  await expect(page.locator("[data-report]").first()).toBeVisible(SLOW);
};
const grip = (page: Page, number: number) => page.locator(`[data-report="${number}"] [data-grip]`);
// By structure, not by wording: `ready` also runs in the pseudo-language.
const cardMenu = (page: Page, number: number) =>
  page.locator(`[data-report="${number}"] [role=combobox]`);

export const boardScreens: Screen[] = [
  {
    id: "board-maintenance",
    description:
      "The Board as Maintenance staff: a column per Status in order (the last one empty), the correction column, grips and Status menus, and the note that Reporter comments are not checked yet.",
    server: "seeded",
    path: "/staff/reports?layout=board",
    prepare: signedIn("maintenance"),
    ready: boardShown,
    allowText,
  },
  {
    id: "board-viewer",
    description: "The Board as a Viewer: the same cards with no grip and no Status menu.",
    server: "seeded",
    path: "/staff/reports?layout=board",
    prepare: signedIn("viewer"),
    ready: boardShown,
    allowText,
  },
  {
    id: "board-reporter-marks",
    description:
      "The Board after the Reporter-comment scan: the mark with the count on the cards that have Reporter comments, and the chip pressed.",
    server: "seeded",
    path: "/staff/reports?layout=board&reporter=1",
    prepare: signedIn("maintenance"),
    ready: async (page) => {
      await boardShown(page);
      await expect(page.locator("[data-reporter-mark]").first()).toBeVisible(SLOW);
    },
    allowText,
  },
  {
    id: "board-scan-loading",
    description:
      "The Reporter-comment chip pressed while the scan runs: loading, never an empty list.",
    server: "seeded",
    path: "/staff/reports?layout=board&reporter=1",
    prepare: signedIn("maintenance", { comments: "hold" }),
    ready: async (page) => {
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible(SLOW);
      await expect(page.getByRole("status")).toBeVisible(SLOW);
      await expect(page.locator("[data-board]")).toHaveCount(0);
    },
    allowText,
  },
  {
    id: "board-drag",
    description:
      "A card lifted with the keyboard and nudged down: lifted with the floating shadow and an accent border, over its own column. (Lifted by keyboard, because the screenshot run moves the mouse away.)",
    server: "seeded",
    path: "/staff/reports?layout=board",
    prepare: signedIn("maintenance"),
    ready: async (page) => {
      await boardShown(page);
      await grip(page, 44).focus();
      await page.keyboard.press("Space");
      // One step down stays over its own column, so a drop that happens anyway moves nothing.
      await page.keyboard.press("ArrowDown");
      await expect(page.locator("[data-dnd-dragging]")).toHaveClass(/shadow-floating/);
    },
    allowText,
  },
  {
    id: "board-card-menu",
    description: "A card's Status menu open: the accessible way to move it.",
    server: "seeded",
    path: "/staff/reports?layout=board",
    prepare: signedIn("maintenance"),
    ready: async (page) => {
      await boardShown(page);
      await cardMenu(page, 44).evaluate((element) => element.scrollIntoView({ block: "start" }));
      // Scrolled up, the menu opens below its card instead of over it.
      await cardMenu(page, 44).click();
      await expect(page.getByRole("listbox")).toBeVisible();
    },
    allowText,
  },
  {
    id: "board-rollback",
    description: "A move whose PATCH failed: the card is back in its column and a notice says so.",
    server: "seeded",
    path: "/staff/reports?layout=board",
    prepare: signedIn("maintenance", { failPatch: true }),
    ready: async (page) => {
      await boardShown(page);
      await cardMenu(page, 44).click();
      await page.getByRole("listbox").getByRole("option").nth(2).click();
      await expect(page.getByRole("alert")).toBeVisible(SLOW);
      await expect(page.locator('[data-column="new"] [data-report="44"]')).toBeVisible();
    },
    allowText,
  },
  {
    id: "list-reporter-filter-sort",
    description:
      "The List with the Reporter-comment chip and the last-Reporter-comment sort applied: the latest comment first, with its mark.",
    server: "seeded",
    path: "/staff/reports?reporter=1&sort=reporter",
    prepare: signedIn("maintenance"),
    ready: async (page) => {
      await expect(page.locator("[data-report]").first()).toBeVisible(SLOW);
      await expect(page.locator("[data-reporter-mark]").first()).toBeVisible(SLOW);
    },
    allowText,
  },
];
