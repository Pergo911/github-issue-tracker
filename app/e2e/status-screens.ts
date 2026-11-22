import { expect, type Page } from "@playwright/test";
import type {
  StatusCommentItem,
  StatusTimelineItem,
  StatusView,
} from "../src/shared/status/view.ts";
import { referenceConfig } from "../src/shared/seed/reference-config.ts";
import type { Screen } from "./screens.ts";
import type { AllowedText } from "./support/pseudo-sweep.ts";

// The Status page screens of ticket #25, declared for screenshots, reference images, axe and the
// pseudo-language sweep (see the note at the top of screens.ts). The Worker's answers are faked with
// `page.route`: a screen must look the same on every run and must not spend the per-IP or per-token limits.

const TOKEN = "8s2Qn1vYt0xk7ZcLw3HfPA";
const path = `/status/${TOKEN}`;
const lookupUrl = "**/api/status/lookup";
const commentUrl = "**/api/status/comment";
const reissueUrl = "**/api/status/reissue";

/** What a Reporter wrote and what Staff answered: data, not catalog wording. */
const typed = {
  title: "Elakadt a lift a lépcsőházban",
  place: "B lépcsőház, hátsó lift",
  description: "A lift megáll a 2. és 3. emelet között, és nem nyílik az ajtaja.",
  reporterComment: "Ma reggel is elakadt, egy gyerek bent rekedt egy percre.",
  staffComment: "Köszönjük, a liftszerelő csütörtökön reggel kijön.",
  reply: "Köszönöm a gyors választ!",
};

// Longest first, so "Egyéb kültéri terület" is removed before its part "Egyéb".
const taxonomyNames = Object.values(referenceConfig.taxonomy)
  .flat()
  .map((value) => value.name)
  .sort((a, b) => b.length - a.length);

const statusData: AllowedText[] = [
  referenceConfig.displayName,
  typed.title,
  typed.place,
  typed.description,
  typed.reporterComment,
  typed.staffComment,
  typed.reply,
  ...taxonomyNames,
  // A timestamp in the configured language and time zone: "2026. márc. 1. 9:00".
  /\d{4}\. [^\s\d]+\. \d{1,2}\. \d{1,2}:\d{2}/,
  // The Report number in the heading is "#12": no letters, listed for clarity.
  /#\d+/,
];

const at = (day: number, hour = 9, minute = 0) =>
  `2026-03-${String(day).padStart(2, "0")}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00Z`;

/** The Report most screens show, with its history: filed, triaged, assigned, a Staff comment, a Reporter comment. */
function view(overrides: Partial<StatusView> = {}): StatusView {
  return {
    number: 12,
    title: typed.title,
    body: { kind: "report", place: typed.place, description: typed.description },
    state: "open",
    closeReason: null,
    status: "in-progress",
    category: "elevator",
    location: "stairwell",
    assigned: true,
    createdAt: at(2, 8, 30),
    updatedAt: at(5, 14, 10),
    closedAt: null,
    timeline: [
      { kind: "status", id: "new", at: at(2, 8, 30) },
      { kind: "category", id: "elevator", at: at(2, 8, 30) },
      { kind: "location", id: "stairwell", at: at(2, 8, 30) },
      { kind: "assigned", at: at(3, 10, 5) },
      { kind: "status", id: "in-progress", at: at(3, 10, 6) },
      { kind: "comment", author: "staff", text: typed.staffComment, at: at(3, 10, 20) },
      { kind: "comment", author: "reporter", text: typed.reporterComment, at: at(5, 14, 10) },
    ],
    ...overrides,
  };
}

const closedTimeline = (reason: "fixed" | "rejected" | "duplicate"): StatusTimelineItem[] => [
  ...view().timeline,
  { kind: "closed", reason, at: at(6, 11, 0) },
];

/** Fakes the lookup's answer (`null`: a 404 as for an unknown or replaced link). */
const serve = (answer: StatusView | { status: number; code: string }) => async (page: Page) => {
  await page.route(lookupUrl, (route) =>
    "code" in answer
      ? route.fulfill({ status: answer.status, json: { error: { code: answer.code } } })
      : route.fulfill({ status: 200, json: answer }),
  );
};

const headingShown = async (page: Page) => {
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.locator("#history-heading")).toBeVisible();
};

const openCommentBox = (page: Page) => page.locator("#comment");
// By structure, not by wording: `ready` also runs in the pseudo-language, where every name is different.
const submitComment = (page: Page) => page.locator("form button[type=submit]");
const reissueButton = (page: Page) => page.locator("#reissue-heading ~ div button");
const confirmReissue = (page: Page) => page.getByRole("dialog").getByRole("button").last();

function fakeComment(
  page: Page,
  answer: { status: number; code?: string; comment?: StatusCommentItem },
) {
  return page.route(commentUrl, (route) =>
    answer.code
      ? route.fulfill({ status: answer.status, json: { error: { code: answer.code } } })
      : route.fulfill({
          status: 200,
          json: {
            accepted: true,
            comment: answer.comment ?? {
              kind: "comment",
              author: "reporter",
              text: typed.reply,
              at: at(5, 15, 0),
            },
          },
        }),
  );
}

const manyEvents: StatusTimelineItem[] = Array.from({ length: 14 }, (_, index) => {
  const day = 2 + Math.floor(index / 2);
  if (index % 4 === 0) {
    return {
      kind: "comment",
      author: index % 8 === 0 ? "staff" : "reporter",
      text: index % 8 === 0 ? typed.staffComment : typed.reporterComment,
      at: at(day, 9 + index),
    } satisfies StatusTimelineItem;
  }
  if (index % 4 === 1) {
    return {
      kind: "status",
      id: index % 8 === 1 ? "on-hold" : "in-progress",
      at: at(day, 9 + index),
    };
  }
  if (index % 4 === 2)
    return { kind: index % 8 === 2 ? "assigned" : "unassigned", at: at(day, 9 + index) };
  return { kind: "comment", author: "reporter", text: typed.reply, at: at(day, 9 + index) };
});

export const statusScreens: Screen[] = [
  ...(["new", "in-progress", "on-hold"] as const).map((status): Screen => ({
    id: `status-open-${status}`,
    description: `An open Report in the configured Status "${status}": the pill, details, history and the comment box.`,
    server: "seeded",
    path,
    prepare: serve(view({ status })),
    ready: headingShown,
    allowText: statusData,
  })),
  {
    id: "status-open-invalid-status",
    description:
      "An open Report with no valid Status (none, several or an obsolete one): Awaiting status update.",
    server: "seeded",
    path,
    prepare: serve(view({ status: null })),
    ready: headingShown,
    allowText: statusData,
  },
  {
    id: "status-open-unassigned-plain-body",
    description:
      "Not assigned, and a body Staff edited after submission, shown as plain text with a note.",
    server: "seeded",
    path,
    prepare: serve(
      view({
        assigned: false,
        status: "new",
        body: { kind: "plain", text: `${typed.description}\n\n${typed.place}` },
        timeline: [],
      }),
    ),
    ready: async (page) => {
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    },
    allowText: statusData,
  },
  ...(["fixed", "rejected", "duplicate"] as const).map((reason): Screen => ({
    id: `status-closed-${reason}`,
    description: `A Report closed as ${reason}: the reason in the pill, the stale Status ignored, and the closed-Report notice by the comment box.`,
    server: "seeded",
    path,
    prepare: serve(
      view({
        state: "closed",
        closeReason: reason,
        closedAt: at(6, 11, 0),
        updatedAt: at(6, 11, 0),
        status: null,
        timeline: closedTimeline(reason),
      }),
    ),
    ready: headingShown,
    allowText: statusData,
  })),
  {
    id: "status-long-history",
    description: "A long history with many comments, Reporter and Staff, in one timeline.",
    server: "seeded",
    path,
    prepare: serve(view({ timeline: [...view().timeline, ...manyEvents, ...manyEvents] })),
    ready: headingShown,
    allowText: statusData,
  },
  {
    id: "status-comment-empty",
    description: "Comment pressed with nothing typed: the length error under the box, focus kept.",
    server: "seeded",
    path,
    prepare: serve(view()),
    ready: async (page) => {
      await headingShown(page);
      await submitComment(page).click();
      await expect(openCommentBox(page)).toHaveAttribute("aria-invalid", "true");
    },
    allowText: statusData,
  },
  {
    id: "status-comment-rate-limited",
    description: "The comment limit is hit (429): the error banner, the typed text kept.",
    server: "seeded",
    path,
    prepare: async (page) => {
      await serve(view())(page);
      await fakeComment(page, { status: 429, code: "rate_limited" });
    },
    ready: async (page) => {
      await headingShown(page);
      await openCommentBox(page).fill(typed.reply);
      await submitComment(page).click();
      await expect(page.getByRole("alert")).toBeVisible();
    },
    allowText: statusData,
  },
  {
    id: "status-comment-sent",
    description:
      "A comment was added: the confirmation and the new Reporter comment in the timeline.",
    server: "seeded",
    path,
    prepare: async (page) => {
      let calls = 0;
      await page.route(lookupUrl, (route) => {
        calls += 1;
        const answer =
          calls === 1
            ? view()
            : view({
                timeline: [
                  ...view().timeline,
                  { kind: "comment", author: "reporter", text: typed.reply, at: at(5, 15, 0) },
                ],
              });
        return route.fulfill({ status: 200, json: answer });
      });
      await fakeComment(page, { status: 200 });
    },
    ready: async (page) => {
      await headingShown(page);
      await openCommentBox(page).fill(typed.reply);
      const refreshed = page.waitForResponse(lookupUrl);
      await submitComment(page).click();
      await expect(page.getByRole("status")).toBeVisible();
      await expect(page.getByText(typed.reply)).toBeVisible();
      await refreshed;
    },
    allowText: statusData,
  },
  {
    id: "status-reissue-dialog",
    description: "Reissue pressed: the confirmation dialog with the SPEC 4.3 wording.",
    server: "seeded",
    path,
    prepare: serve(view()),
    ready: async (page) => {
      await headingShown(page);
      await reissueButton(page).click();
      await expect(page.getByRole("dialog")).toBeVisible();
    },
    allowText: statusData,
    freshOnViewport: true,
  },
  {
    id: "status-reissued",
    description:
      "The Reissue was confirmed: the page says a new link was sent; the old one is gone.",
    server: "seeded",
    path,
    prepare: async (page) => {
      await serve(view())(page);
      await page.route(reissueUrl, (route) => route.fulfill({ status: 200, json: { sent: true } }));
    },
    ready: async (page) => {
      await headingShown(page);
      await reissueButton(page).click();
      await confirmReissue(page).click();
      await expect(page.getByRole("status")).toBeVisible();
    },
    allowText: statusData,
  },
  {
    id: "status-reissue-limited",
    description:
      "The third Reissue of the day was already used (429): the error banner by the button.",
    server: "seeded",
    path,
    prepare: async (page) => {
      await serve(view())(page);
      await page.route(reissueUrl, (route) =>
        route.fulfill({ status: 429, json: { error: { code: "rate_limited" } } }),
      );
    },
    ready: async (page) => {
      await headingShown(page);
      await reissueButton(page).click();
      await confirmReissue(page).click();
      await expect(page.getByRole("alert")).toBeVisible();
    },
    allowText: statusData,
  },
  {
    id: "status-not-found",
    description:
      "An unknown, malformed or replaced link: the generic 404 page that says to check the latest email.",
    server: "seeded",
    path,
    prepare: serve({ status: 404, code: "not_found" }),
    ready: async (page) => {
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    },
    allowText: [referenceConfig.displayName],
  },
  {
    id: "status-lookup-rate-limited",
    description: "The lookup limit is hit (429): the error and a retry button.",
    server: "seeded",
    path,
    prepare: serve({ status: 429, code: "rate_limited" }),
    ready: async (page) => {
      await expect(page.getByRole("alert")).toBeVisible();
    },
    allowText: [referenceConfig.displayName],
  },
];
