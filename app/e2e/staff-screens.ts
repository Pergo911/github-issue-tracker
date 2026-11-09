import { expect, type Page } from "@playwright/test";
import { referenceConfig } from "../src/shared/seed/reference-config.ts";
import type { Screen } from "./screens.ts";
import type { AllowedText } from "./support/pseudo-sweep.ts";
import { serveReports, staffToken, startSignedIn, type IssueFixture } from "./support/staff.ts";

// The Staff screens of ticket #27, declared for screenshots, reference images, axe and the pseudo-language sweep
// (see the note at the top of screens.ts). Sign-in, the device flow's Worker proxy and the role check go through
// the real Worker and fake GitHub; the Reports and the device code are fixed so every run looks the same.

/** Names from the configuration and the logins of the Staff users the screens sign in as: data, not catalog. */
// Longest first: "Egyéb kültéri terület" must be removed before its part "Egyéb".
const taxonomyNames = Object.values(referenceConfig.taxonomy)
  .flat()
  .map((value) => value.name)
  .sort((a, b) => b.length - a.length);
export const staffData: AllowedText[] = [
  referenceConfig.displayName,
  ...taxonomyNames,
  /screen-[a-z]+/,
  // An unknown label shows its raw identifier (the fixtures have one).
  "category:legacy-paint",
  "status:retired",
];

/** The Reports the List screens show. Ages are counted from 2026-06-15 12:00 UTC (see `serveReports`). */
const fixtures: IssueFixture[] = [
  {
    number: 41,
    title: "Beragadt a lift ajtaja",
    labels: ["category:elevator", "location:elevator", "priority:urgent", "status:on-hold"],
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
    number: 44,
    title: "Csöpög a csap a 2. emeleti közös mosdóban",
    labels: ["category:plumbing", "location:floor-2", "priority:high", "status:new"],
    createdAt: "2026-06-10T14:15:00Z",
  },
  {
    number: 46,
    title: "Hideg a radiátor az 1. emeleten",
    labels: ["category:heating-cooling", "location:floor-1", "status:new"],
    createdAt: "2026-06-12T07:45:00Z",
  },
  {
    number: 43,
    title: "Nem zárul a garázskapu",
    labels: ["category:doors-windows", "location:garage", "priority:low"],
    createdAt: "2026-06-05T16:00:00Z",
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
  {
    number: 35,
    title: "Teljes tetőcsere igénye",
    labels: ["category:structural", "location:roof"],
    state: "closed",
    stateReason: "not_planned",
    createdAt: "2026-04-18T12:00:00Z",
  },
];

const titles = fixtures.map((fixture) => fixture.title);
const invalidOnly = fixtures.filter((fixture) => [43, 42, 40].includes(fixture.number));

const deviceCode = {
  deviceCode: "screen-device-code",
  userCode: "WDJB-MJHT",
  verificationUri: "https://github.com/login/device",
  expiresIn: 900,
  interval: 1,
};

const issuesUrl = /\/repos\/[^/]+\/[^/]+\/issues\?/;

// The first visit to /staff makes the dev server transform the whole staff chunk: on a busy machine (verify runs
// the visual and end-to-end steps together) that takes longer than Playwright's default 10 s.
const SLOW = { timeout: 30_000 };
const headingShown = async (page: Page) => {
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible(SLOW);
};
const reportsShown = async (page: Page) => {
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible(SLOW);
  await expect(page.locator("[data-report]").first()).toBeVisible(SLOW);
};

/** Signs in as a Staff user and serves the given Reports (and search hits). */
function signedInList(
  login: string,
  role: "viewer" | "maintenance" | "admin",
  issues: IssueFixture[] = fixtures,
  searchHits: IssueFixture[] = [],
) {
  return async (page: Page) => {
    const { token } = await staffToken(login, role);
    await startSignedIn(page, token);
    await serveReports(page, issues, { searchHits });
  };
}

/** Fixes the device code and what every poll answers. */
function deviceFlow(poll: unknown) {
  return async (page: Page) => {
    await page.route("**/api/staff/device-code", (route) => route.fulfill({ json: deviceCode }));
    await page.route("**/api/staff/device-token", (route) => route.fulfill({ json: poll }));
  };
}

export const staffScreens: Screen[] = [
  {
    id: "staff-sign-in",
    description: "The Staff sign-in screen, signed out.",
    server: "seeded",
    path: "/staff",
    ready: headingShown,
    allowText: staffData,
  },
  {
    id: "staff-device-code",
    description: "The device-code screen while waiting for the member to approve (a fixed code).",
    server: "seeded",
    path: "/staff",
    prepare: deviceFlow({ status: "pending" }),
    ready: async (page) => {
      await page.getByRole("button").click();
      await expect(page.getByText(deviceCode.userCode)).toBeVisible();
    },
    allowText: [...staffData, deviceCode.userCode],
  },
  {
    id: "staff-device-code-expired",
    description: "The device code has expired after 900 seconds: the restart offer.",
    server: "seeded",
    path: "/staff",
    prepare: deviceFlow({ status: "expired" }),
    ready: async (page) => {
      await page.getByRole("button").click();
      await expect(page.getByRole("button")).toBeVisible();
      await expect(page.getByText(deviceCode.userCode)).toHaveCount(0);
      await headingShown(page);
    },
    allowText: staffData,
  },
  {
    id: "staff-no-access",
    description: "A signed-in account that is not a member of the reports repo.",
    server: "seeded",
    path: "/staff/reports",
    prepare: async (page) => {
      const { token } = await staffToken("screen-outsider", "none");
      await startSignedIn(page, token);
    },
    ready: headingShown,
    allowText: staffData,
  },
  {
    id: "staff-list-viewer",
    description:
      "The List as a Viewer: no Admin links, open Reports by Priority, then oldest first.",
    server: "seeded",
    path: "/staff/reports",
    prepare: signedInList("screen-viewer", "viewer"),
    ready: reportsShown,
    allowText: [...titles, ...staffData],
  },
  {
    id: "staff-list-maintenance",
    description: "The List as Maintenance staff.",
    server: "seeded",
    path: "/staff/reports",
    prepare: signedInList("screen-maintenance", "maintenance"),
    ready: reportsShown,
    allowText: [...titles, ...staffData],
  },
  {
    id: "staff-list-admin",
    description: "The List as a System admin: the Allowlist and Configuration links are there.",
    server: "seeded",
    path: "/staff/reports",
    prepare: signedInList("screen-admin", "admin"),
    ready: reportsShown,
    allowText: [...titles, ...staffData],
  },
  {
    id: "staff-list-filtered",
    description: "Filters applied: Category and Priority chips set, in the URL.",
    server: "seeded",
    path: "/staff/reports?category=plumbing&priority=high",
    prepare: signedInList("screen-maintenance", "maintenance"),
    ready: reportsShown,
    allowText: [...titles, ...staffData],
  },
  {
    id: "staff-list-closed",
    description: "The closed Reports: the purple (fixed) and grey (rejected) state icons.",
    server: "seeded",
    path: "/staff/reports?state=closed",
    prepare: signedInList("screen-maintenance", "maintenance"),
    ready: reportsShown,
    allowText: [...titles, ...staffData],
  },
  {
    id: "staff-list-empty",
    description: "Filters that match no Report.",
    server: "seeded",
    path: "/staff/reports?category=elevator&status=new",
    prepare: signedInList("screen-maintenance", "maintenance"),
    ready: async (page) => {
      await expect(page.getByRole("heading", { level: 2 })).toBeVisible();
    },
    allowText: staffData,
  },
  {
    id: "staff-list-search",
    description: "Search results across the whole history, open and closed together.",
    server: "seeded",
    path: "/staff/reports?q=lift",
    prepare: signedInList("screen-maintenance", "maintenance", fixtures, [
      fixtures[0] as IssueFixture,
      fixtures[7] as IssueFixture,
    ]),
    ready: reportsShown,
    allowText: [...titles, ...staffData, "lift"],
  },
  {
    id: "staff-list-invalid-status",
    description:
      "Reports with no Status, several Statuses and an obsolete value: a warning on the row, and an unknown label shown by its raw identifier.",
    server: "seeded",
    path: "/staff/reports",
    prepare: signedInList("screen-maintenance", "maintenance", invalidOnly),
    ready: reportsShown,
    allowText: [
      ...staffData,
      ...invalidOnly.map((fixture) => fixture.title),
      "category:legacy-paint",
    ],
  },
  {
    id: "staff-list-loading",
    description: "The List while the Reports load (the request never answers).",
    server: "seeded",
    path: "/staff/reports",
    prepare: async (page) => {
      const { token } = await staffToken("screen-maintenance", "maintenance");
      await startSignedIn(page, token);
      await page.route(issuesUrl, () => {
        // Held: the loading state stays.
      });
    },
    ready: async (page) => {
      // The dashboard's frame is up (not the boot spinner, which is also a status), and the Reports are loading.
      await expect(page.getByRole("navigation")).toBeVisible();
      await expect(page.getByRole("status")).toBeVisible();
    },
    allowText: staffData,
  },
  {
    id: "staff-list-error",
    description: "The List when the Reports could not be loaded: an error with a retry.",
    server: "seeded",
    path: "/staff/reports",
    prepare: async (page) => {
      const { token } = await staffToken("screen-maintenance", "maintenance");
      await startSignedIn(page, token);
      await page.route(issuesUrl, (route) => route.abort("connectionrefused"));
    },
    ready: async (page) => {
      await expect(page.getByRole("heading", { level: 2 })).toBeVisible();
    },
    allowText: staffData,
  },
];
