import { describe, expect, it } from "vitest";
import { buildReportBody } from "../reports/body.ts";
import { buildReporterComment } from "../reports/attribution.ts";
import { catalogFor, createTranslator } from "../i18n/index.ts";
import { referenceConfig } from "../seed/reference-config.ts";
import { configSchema } from "../config/schema.ts";
import type { GitHubIssue, GitHubTimelineEvent } from "../github/types.ts";
import { buildStatusView, statusViewSchema } from "./view.ts";

// The public projection of a Report for the Status page (SPEC 4.3, issue #25): an explicit allowlist, so a
// new GitHub field is private by default.

const config = configSchema.parse(referenceConfig);
const bot = { login: "fault-reports-bot[bot]", id: 9001, type: "Bot" as const, appId: 424242 };
const t = createTranslator(catalogFor("hu"));

const user = (login: string, id: number, type = "User") => ({
  login,
  id,
  type,
  node_id: `N_${id}`,
  avatar_url: `https://avatars.example/${login}.png`,
  html_url: `https://github.example/${login}`,
  site_admin: false,
});
const botUser = user(bot.login, bot.id, "Bot");
const staff = user("gondnok-jozsi", 5);

const MARKER = "attemptmarker0123456789";
const body = buildReportBody({
  t,
  categoryName: "Lift",
  locationName: "Lépcsőház",
  place: "B lépcsőház",
  description: "A lift megáll.\n```\nnem kerítés",
  marker: MARKER,
});

const label = (id: number, name: string) => ({
  id,
  node_id: `L${id}`,
  name,
  description: null,
  color: "aaaaaa",
  default: false,
});

function issue(overrides: Partial<GitHubIssue> = {}): GitHubIssue {
  return {
    id: 1,
    node_id: "I_1",
    number: 7,
    title: "Elakadt a lift",
    body,
    state: "open",
    state_reason: null,
    locked: false,
    comments: 0,
    created_at: "2026-03-01T08:00:00Z",
    updated_at: "2026-03-02T08:00:00Z",
    closed_at: null,
    url: "https://api.example/issues/7",
    html_url: "https://github.example/o/r/issues/7",
    comments_url: "u",
    events_url: "u",
    labels_url: "u",
    repository_url: "u",
    timeline_url: "u",
    author_association: "NONE",
    performed_via_github_app: null,
    user: botUser,
    labels: [
      label(1, "category:elevator"),
      label(2, "location:stairwell"),
      label(3, "status:in-progress"),
      label(4, "priority:high"),
      label(5, "wontfix-ish"),
    ],
    assignee: staff,
    assignees: [staff],
    closed_by: null,
    ...overrides,
  };
}

let eventId = 100;
const base = (actor: ReturnType<typeof user>, at: string) => ({
  id: ++eventId,
  node_id: `E_${eventId}`,
  url: "https://api.example/events",
  actor,
  created_at: at,
  performed_via_github_app: null,
});
const labeled = (name: string, at: string, actor = staff): GitHubTimelineEvent => ({
  ...base(actor, at),
  event: "labeled",
  commit_id: null,
  commit_url: null,
  label: { name, color: "ffffff" },
});
const assignment = (
  kind: "assigned" | "unassigned",
  at: string,
  who = staff,
): GitHubTimelineEvent => ({
  ...base(staff, at),
  event: kind,
  commit_id: null,
  commit_url: null,
  assignee: who,
});
const closing = (
  kind: "closed" | "reopened",
  at: string,
  reason: "completed" | "not_planned" | "duplicate" | "reopened" | null,
): GitHubTimelineEvent => ({
  ...base(staff, at),
  event: kind,
  commit_id: null,
  commit_url: null,
  state_reason: reason,
});
const renamed = (at: string): GitHubTimelineEvent => ({
  ...base(staff, at),
  event: "renamed",
  commit_id: null,
  commit_url: null,
  rename: { from: "Titkos régi cím", to: "Új cím" },
});
const commented = (
  author: ReturnType<typeof user>,
  text: string,
  at: string,
): GitHubTimelineEvent => ({
  event: "commented",
  actor: author,
  performed_via_github_app: null,
  id: ++eventId,
  node_id: "C",
  url: "https://api.example/comments/1",
  html_url: "https://github.example/c",
  issue_url: "i",
  body: text,
  user: author,
  created_at: at,
  updated_at: at,
  author_association: "NONE",
});

function view(overrides: Partial<GitHubIssue> = {}, timeline: GitHubTimelineEvent[] = []) {
  return buildStatusView({ issue: issue(overrides), timeline, taxonomy: config.taxonomy, bot });
}

describe("buildStatusView: the current details", () => {
  it("projects number, title, decoded body with the exact place, classification and presence", () => {
    expect(view()).toMatchObject({
      number: 7,
      title: "Elakadt a lift",
      body: {
        kind: "report",
        place: "B lépcsőház",
        description: "A lift megáll.\n```\nnem kerítés",
      },
      state: "open",
      closeReason: null,
      status: "in-progress",
      category: "elevator",
      location: "stairwell",
      assigned: true,
      createdAt: "2026-03-01T08:00:00Z",
      updatedAt: "2026-03-02T08:00:00Z",
      closedAt: null,
    });
  });

  it("an Exact place is optional in the body", () => {
    const noPlace = buildReportBody({
      t,
      categoryName: "Lift",
      locationName: "Lépcsőház",
      description: "csak leírás",
      marker: MARKER,
    });
    expect(view({ body: noPlace }).body).toEqual({
      kind: "report",
      place: null,
      description: "csak leírás",
    });
  });

  it("reads a body written in the other shipped language", () => {
    const english = buildReportBody({
      t: createTranslator(catalogFor("en")),
      categoryName: "Lift",
      locationName: "Stairwell",
      place: "B",
      description: "stuck",
      marker: MARKER,
    });
    expect(view({ body: english }).body).toEqual({
      kind: "report",
      place: "B",
      description: "stuck",
    });
  });

  it("a Staff-edited body falls back to plain text without the correlation marker", () => {
    const result = view({
      body: `${body}
A gondnok kiegészítése: MEGÁLL.`,
    }).body;
    expect(result.kind).toBe("plain");
    expect(JSON.stringify(result)).not.toContain(MARKER);
    expect(JSON.stringify(result)).toContain("MEGÁLL.");
  });

  it("a body the Bot did not write is plain text even when it looks canonical", () => {
    expect(view({ user: staff }).body.kind).toBe("plain");
  });

  it("is unassigned with no assignees", () => {
    expect(view({ assignee: null, assignees: [] }).assigned).toBe(false);
  });
});

describe("buildStatusView: Status (SPEC 2.3, 2.4)", () => {
  const withStatuses = (...names: string[]) =>
    view({ labels: names.map((name, index) => label(50 + index, name)) });

  it("a configured Status is shown", () => {
    expect(withStatuses("status:on-hold").status).toBe("on-hold");
  });

  it.each([
    ["none", []],
    ["several", ["status:new", "status:on-hold"]],
    ["an obsolete one", ["status:retired"]],
  ])("%s shows the Awaiting status update fallback (status null)", (_name, names) => {
    const result = withStatuses(...names);
    expect(result.status).toBeNull();
    expect(result.state).toBe("open");
  });

  it.each([
    [null, "fixed"],
    ["completed", "fixed"],
    ["not_planned", "rejected"],
    ["duplicate", "duplicate"],
  ] as const)(
    "a closed Report (%s) shows its reason and ignores a stale Status",
    (reason, shown) => {
      const result = view({
        state: "closed",
        state_reason: reason,
        closed_at: "2026-03-03T08:00:00Z",
      });
      expect(result).toMatchObject({
        state: "closed",
        closeReason: shown,
        status: null,
        closedAt: "2026-03-03T08:00:00Z",
      });
    },
  );
});

describe("buildStatusView: history and comments", () => {
  it("lists only the allowed event kinds, in order, with no identities", () => {
    const result = view({}, [
      labeled("status:in-progress", "2026-03-01T09:00:00Z"),
      labeled("priority:high", "2026-03-01T09:01:00Z"),
      labeled("category:plumbing", "2026-03-01T09:02:00Z"),
      labeled("location:courtyard", "2026-03-01T09:03:00Z"),
      labeled("status:mystery", "2026-03-01T09:04:00Z"),
      assignment("assigned", "2026-03-01T09:05:00Z"),
      renamed("2026-03-01T09:06:00Z"),
      closing("closed", "2026-03-01T09:07:00Z", "not_planned"),
      closing("reopened", "2026-03-01T09:08:00Z", "reopened"),
    ]);
    expect(result.timeline).toEqual([
      { kind: "status", id: "in-progress", at: "2026-03-01T09:00:00Z" },
      { kind: "category", id: "plumbing", at: "2026-03-01T09:02:00Z" },
      { kind: "location", id: "courtyard", at: "2026-03-01T09:03:00Z" },
      { kind: "assigned", at: "2026-03-01T09:05:00Z" },
      { kind: "closed", reason: "rejected", at: "2026-03-01T09:07:00Z" },
      { kind: "reopened", at: "2026-03-01T09:08:00Z" },
    ]);
  });

  it("an assignment shows only when presence changes", () => {
    const other = user("masik", 6);
    const result = view({}, [
      assignment("assigned", "2026-03-01T09:00:00Z"),
      assignment("assigned", "2026-03-01T09:01:00Z", other),
      assignment("unassigned", "2026-03-01T09:02:00Z", other),
      assignment("unassigned", "2026-03-01T09:03:00Z"),
    ]);
    expect(result.timeline).toEqual([
      { kind: "assigned", at: "2026-03-01T09:00:00Z" },
      { kind: "unassigned", at: "2026-03-01T09:03:00Z" },
    ]);
  });

  it("comments carry only author, text and time; a Reporter is decoded, a lookalike stays Staff", () => {
    const lookalike = buildReporterComment("Nem a bejelentő vagyok");
    const result = view({}, [
      commented(botUser, buildReporterComment("Még mindig nem megy."), "2026-03-01T10:00:00Z"),
      commented(staff, "Kijövünk holnap.", "2026-03-01T11:00:00Z"),
      commented(staff, lookalike, "2026-03-01T12:00:00Z"),
    ]);
    expect(result.timeline).toEqual([
      {
        kind: "comment",
        author: "reporter",
        text: "Még mindig nem megy.",
        at: "2026-03-01T10:00:00Z",
      },
      { kind: "comment", author: "staff", text: "Kijövünk holnap.", at: "2026-03-01T11:00:00Z" },
      { kind: "comment", author: "staff", text: lookalike, at: "2026-03-01T12:00:00Z" },
    ]);
  });
});

describe("the strict public schema (SPEC 4.3 allowlist)", () => {
  const rich = () =>
    view({}, [
      labeled("status:in-progress", "2026-03-01T09:00:00Z"),
      labeled("priority:high", "2026-03-01T09:01:00Z"),
      assignment("assigned", "2026-03-01T09:05:00Z"),
      renamed("2026-03-01T09:06:00Z"),
      commented(botUser, buildReporterComment("Segítség"), "2026-03-01T10:00:00Z"),
      commented(
        staff,
        "Megnézzük, lásd #3 és https://github.example/o/r/issues/3",
        "2026-03-01T11:00:00Z",
      ),
    ]);

  it("parses under the strict schema", () => {
    expect(() => statusViewSchema.parse(rich())).not.toThrow();
  });

  it("rejects a response with any extra field", () => {
    expect(() => statusViewSchema.parse({ ...rich(), priority: "high" })).toThrow();
    const withExtra = rich();
    expect(() =>
      statusViewSchema.parse({
        ...withExtra,
        timeline: [{ ...withExtra.timeline[0], actor: "gondnok-jozsi" }],
      }),
    ).toThrow();
  });

  it("never carries Priority, logins, avatars, URLs, the marker, rename history or raw objects", () => {
    const text = JSON.stringify(rich());
    for (const secret of [
      "priority",
      "high",
      "gondnok-jozsi",
      bot.login,
      "avatar",
      "node_id",
      "api.example",
      MARKER,
      "Titkos régi cím",
      "wontfix-ish",
      "fault-report-attempt",
    ]) {
      expect(text, secret).not.toContain(secret);
    }
  });
});
