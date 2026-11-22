import { expect, type Page } from "@playwright/test";
import { catalogFor, createTranslator } from "../src/shared/i18n/index.ts";
import { buildReporterComment } from "../src/shared/reports/attribution.ts";
import { buildReportBody } from "../src/shared/reports/body.ts";
import { referenceConfig } from "../src/shared/seed/reference-config.ts";
import type { Screen } from "./screens.ts";
import type { AllowedText } from "./support/pseudo-sweep.ts";
import { respond, staffToken, startSignedIn } from "./support/staff.ts";
import { worldOf } from "./support/test.ts";
import { SLOW } from "./support/timings.ts";

// The Staff Detail view screens of ticket #28, declared for screenshots, reference images, axe and the
// pseudo-language sweep (see the note at the top of screens.ts). Sign-in and the role check go through the real
// Worker and the fake GitHub; the Report, its timeline and the Worker's contact answers are fixed with `page.route`
// so every run looks the same.

const typed = {
  title: "Elakadt a lift a lépcsőházban",
  place: "B lépcsőház, hátsó lift",
  description: "A lift megáll a 2. és 3. emelet között, és nem nyílik az ajtaja.",
  reporterComment: "Ma reggel is elakadt, egy gyerek bent rekedt egy percre.",
  staffComment: "Köszönjük, a liftszerelő csütörtökön reggel kijön.",
  email: "kiss.anna@example.hu",
  note: "Kiss Anna, 2/4",
};

const taxonomyNames = Object.values(referenceConfig.taxonomy)
  .flat()
  .map((value) => value.name)
  .sort((a, b) => b.length - a.length);

const detailData: AllowedText[] = [
  referenceConfig.displayName,
  typed.title,
  typed.place,
  typed.description,
  typed.reporterComment,
  typed.staffComment,
  typed.email,
  typed.note,
  ...taxonomyNames,
  /screen-[a-z]+/,
  /https:\/\/\S+/,
  /\d{4}\. [^\s\d]+\. \d{1,2}\. \d{1,2}:\d{2}/,
  /#\d+/,
];

const NUMBER = 12;
const at = (day: number, hour = 9) =>
  `2026-03-${String(day).padStart(2, "0")}T${String(hour).padStart(2, "0")}:00:00Z`;
const repoRoute = /\/repos\/[^/]+\/[^/]+\//;

interface Fixture {
  labels?: string[];
  state?: "open" | "closed";
  stateReason?: "completed" | "not_planned" | "duplicate";
  assignees?: string[];
  holdPatch?: boolean;
}

const user = (login: string, id: number, type = "User") => ({ login, id, type });

/** Fakes the Report's GitHub reads and the assignee list; the Bot is the seeded world's, so comments classify. */
function serveDetail(fixture: Fixture = {}) {
  return async (page: Page) => {
    const bot = (await worldOf("seeded").summary()).bot;
    const botUser = user(bot.login, bot.accountId, "Bot");
    const t = createTranslator(catalogFor("hu"));
    const closed = fixture.state === "closed";
    const labelNames = fixture.labels ?? [
      "category:elevator",
      "location:stairwell",
      "priority:high",
      "status:in-progress",
    ];
    const issue = {
      id: 9000 + NUMBER,
      number: NUMBER,
      title: typed.title,
      body: buildReportBody({
        t,
        categoryName: "Lift",
        locationName: "Lépcsőház",
        place: typed.place,
        description: typed.description,
        marker: "abcdefghijklmnopqrstuv",
      }),
      state: closed ? "closed" : "open",
      state_reason: closed ? (fixture.stateReason ?? "completed") : null,
      created_at: at(2, 8),
      updated_at: at(closed ? 6 : 5, 14),
      closed_at: closed ? at(6, 11) : null,
      user: botUser,
      labels: labelNames.map((name) => ({ name, color: "ededed" })),
      assignees: (fixture.assignees ?? ["screen-maintenance"]).map((login) => user(login, 5)),
    };
    const base = (created_at: string) => ({
      created_at,
      performed_via_github_app: null,
      actor: botUser,
    });
    const timeline = [
      { ...base(at(2, 8)), event: "labeled", label: { name: "status:new", color: "1d76db" } },
      {
        ...base(at(2, 8)),
        event: "labeled",
        label: { name: "category:elevator", color: "fbca04" },
      },
      { ...base(at(3, 10)), event: "assigned", assignee: user("screen-maintenance", 5) },
      {
        ...base(at(3, 10)),
        event: "commented",
        user: user("screen-maintenance", 5),
        body: typed.staffComment,
      },
      {
        ...base(at(5, 14)),
        event: "commented",
        user: botUser,
        body: buildReporterComment(typed.reporterComment),
      },
      ...(closed
        ? [
            {
              ...base(at(6, 11)),
              event: "closed",
              state_reason: fixture.stateReason ?? "completed",
            },
          ]
        : []),
    ];
    await page.clock.setFixedTime(new Date("2026-03-10T12:00:00Z"));
    await page.route(new RegExp(`${repoRoute.source}issues/${NUMBER}(\\?|$)`), (route) => {
      if (fixture.holdPatch && route.request().method() === "PATCH") return;
      return respond(route, issue);
    });
    await page.route(new RegExp(`${repoRoute.source}issues/${NUMBER}/timeline`), (route) =>
      respond(route, timeline),
    );
    await page.route(new RegExp(`${repoRoute.source}assignees`), (route) =>
      respond(route, [user("screen-maintenance", 5), user("screen-admin", 6)]),
    );
  };
}

function signedIn(role: "viewer" | "maintenance", fixture?: Fixture) {
  return async (page: Page) => {
    const { token } = await staffToken(`screen-${role}`, role);
    await startSignedIn(page, token);
    await serveDetail(fixture)(page);
  };
}

const path = `/staff/reports/${NUMBER}`;
const shown = async (page: Page) => {
  await expect(page.locator("#history-heading")).toBeVisible(SLOW);
};
// By structure, not by wording: `ready` also runs in the pseudo-language.
const pickers = (page: Page) => page.locator("aside [role=combobox]");
const sidebarButtons = (page: Page) => page.locator("aside button:not([role=combobox])");
const closeButton = (page: Page) => page.locator("form button:not([type=submit])");

const pickerScreen = (id: string, index: number, description: string): Screen => ({
  id,
  description,
  server: "seeded",
  path,
  prepare: signedIn("maintenance"),
  ready: async (page) => {
    await shown(page);
    await pickers(page).nth(index).click();
    await expect(page.getByRole("listbox")).toBeVisible();
  },
  allowText: detailData,
  freshOnViewport: true,
});

const closeScreen = (reason: number, id: string): Screen => ({
  id,
  description: `The close dialog with the "${id.split("-").at(-1)}" reason chosen.`,
  server: "seeded",
  path,
  prepare: signedIn("maintenance"),
  ready: async (page) => {
    await shown(page);
    await closeButton(page).click();
    await page.locator("dialog input[type=radio]").nth(reason).check();
    await expect(page.getByRole("dialog")).toBeVisible();
  },
  allowText: detailData,
  freshOnViewport: true,
});

const closedScreen = (reason: "completed" | "not_planned" | "duplicate", id: string): Screen => ({
  id,
  description: `A Report closed as ${id.split("-").at(-1)}, as Maintenance staff: the Reopen button and no Status picker.`,
  server: "seeded",
  path,
  prepare: signedIn("maintenance", {
    state: "closed",
    stateReason: reason,
    labels: ["category:elevator", "location:stairwell", "priority:high"],
  }),
  ready: shown,
  allowText: detailData,
});

export const detailScreens: Screen[] = [
  {
    id: "detail-viewer",
    description:
      "The Detail view as a Viewer: the decoded body, the timeline with Reporter and Staff comments, the comment box and no action controls.",
    server: "seeded",
    path,
    prepare: signedIn("viewer"),
    ready: shown,
    allowText: detailData,
  },
  {
    id: "detail-maintenance",
    description:
      "The Detail view as Maintenance staff: pickers for Status, Category, Location, Priority and assignee, Close, and reveal-contact.",
    server: "seeded",
    path,
    prepare: signedIn("maintenance"),
    ready: shown,
    allowText: detailData,
  },
  {
    id: "detail-sidebar-saving",
    description:
      "A sidebar field whose edit is in flight: the optimistic value shown with the inline saving indicator next to that section heading.",
    server: "seeded",
    path,
    prepare: signedIn("maintenance", { holdPatch: true }),
    ready: async (page) => {
      await shown(page);
      await pickers(page).nth(1).click();
      await page.getByRole("listbox").getByRole("option").first().click();
      await expect(page.locator("[data-sidebar-saving]")).toBeVisible(SLOW);
    },
    allowText: detailData,
  },
  {
    id: "detail-invalid-status",
    description: "An open Report with two Statuses: the warning and the hint to repair it.",
    server: "seeded",
    path,
    prepare: signedIn("maintenance", {
      labels: ["category:elevator", "location:stairwell", "status:new", "status:in-progress"],
    }),
    ready: shown,
    allowText: detailData,
  },
  closedScreen("completed", "detail-closed-fixed"),
  closedScreen("not_planned", "detail-closed-rejected"),
  closedScreen("duplicate", "detail-closed-duplicate"),
  pickerScreen("detail-picker-status", 0, "The Status picker open."),
  pickerScreen("detail-picker-category", 1, "The Category picker open."),
  pickerScreen("detail-picker-location", 2, "The Location picker open."),
  pickerScreen("detail-picker-priority", 3, "The Priority picker open."),
  pickerScreen("detail-picker-assignee", 4, "The assignee picker open."),
  closeScreen(0, "detail-close-fixed"),
  closeScreen(1, "detail-close-rejected"),
  closeScreen(2, "detail-close-duplicate"),
  {
    id: "detail-contact-revealed",
    description: "Reveal-contact pressed: the email, the Status link and the Allowlist note.",
    server: "seeded",
    path,
    prepare: async (page) => {
      await signedIn("maintenance")(page);
      await page.route("**/api/staff/reveal-contact", (route) =>
        route.fulfill({
          json: {
            email: typed.email,
            statusUrl: "https://reports.example.hu/status/8s2Qn1vYt0xk7ZcLw3HfPA",
            allowlist: { note: typed.note },
          },
        }),
      );
    },
    ready: async (page) => {
      await shown(page);
      await sidebarButtons(page).first().click();
      await expect(page.locator("[data-contact]")).toBeVisible();
    },
    allowText: detailData,
  },
  {
    id: "detail-reissue-confirm",
    description: "Reissue pressed: the confirmation dialog.",
    server: "seeded",
    path,
    prepare: signedIn("maintenance"),
    ready: async (page) => {
      await shown(page);
      await sidebarButtons(page).nth(1).click();
      await expect(page.getByRole("dialog")).toBeVisible();
    },
    allowText: detailData,
    freshOnViewport: true,
  },
  {
    id: "detail-not-found",
    description: "A Report number that does not exist.",
    server: "seeded",
    path: "/staff/reports/9999",
    prepare: async (page) => {
      const { token } = await staffToken("screen-maintenance", "maintenance");
      await startSignedIn(page, token);
      await page.route(new RegExp(`${repoRoute.source}issues/9999`), (route) =>
        route.request().method() === "OPTIONS"
          ? respond(route, {})
          : route.fulfill({
              status: 404,
              headers: { "access-control-allow-origin": "*" },
              json: { message: "Not Found" },
            }),
      );
    },
    ready: async (page) => {
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible(SLOW);
    },
    allowText: detailData,
  },
];
