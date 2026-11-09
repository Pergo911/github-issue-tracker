import { describe, expect, it } from "vitest";
import { configSchema } from "../config/schema.ts";
import type { GitHubIssuesWebhookPayload } from "../github/types.ts";
import { referenceConfig } from "../seed/reference-config.ts";
import { classifyIssuesEvent, type Classification } from "./major-change.ts";

// SPEC 4.2: the receiver's drops and the Major-change filter, written against Status flags. The reference
// configuration has `new` (initial), `in-progress` and `on-hold` (both notify); the test adds a link-only Status.
const config = configSchema.parse({
  ...referenceConfig,
  taxonomy: {
    ...referenceConfig.taxonomy,
    status: [
      ...referenceConfig.taxonomy.status,
      { id: "scheduled", name: "Ütemezve", color: "0e8a16" },
    ],
  },
});
const bot = { login: "reports-bot[bot]", id: 900 };
const botSender = { login: bot.login, id: bot.id, type: "Bot" };
const staff = { login: "gondnok", id: 5, type: "User" };

function payload(
  action: string,
  options: {
    state?: "open" | "closed";
    reason?: string | null;
    label?: string;
    sender?: { login: string; id: number; type: string };
  } = {},
): GitHubIssuesWebhookPayload {
  return {
    action,
    issue: {
      number: 7,
      title: "Elakadt a lift",
      state: options.state ?? "open",
      state_reason: options.reason ?? null,
      labels: [],
    },
    ...(options.label === undefined ? {} : { label: { name: options.label } }),
    sender: options.sender ?? staff,
  } as unknown as GitHubIssuesWebhookPayload;
}

type Case = { name: string; event: GitHubIssuesWebhookPayload; expected: Classification };

const cases: Case[] = [
  // Dropped before anything else
  { name: "deleted erases", event: payload("deleted"), expected: { kind: "erase" } },
  {
    name: "transferred is unsupported",
    event: payload("transferred"),
    expected: { kind: "ignore", why: "transferred" },
  },
  {
    name: "an event the Bot sent",
    event: payload("closed", { state: "closed", sender: botSender }),
    expected: { kind: "ignore", why: "bot" },
  },
  {
    name: "a notify Status entered by the Bot at creation",
    event: payload("labeled", { label: "status:in-progress", sender: botSender }),
    expected: { kind: "ignore", why: "bot" },
  },
  {
    name: "a Status entered while the Report is closed",
    event: payload("labeled", { state: "closed", label: "status:in-progress" }),
    expected: { kind: "ignore", why: "stale-status" },
  },
  {
    name: "entering the initial Status",
    event: payload("labeled", { label: "status:new" }),
    expected: { kind: "ignore", why: "initial" },
  },
  // Major changes
  {
    name: "closed as completed",
    event: payload("closed", { state: "closed", reason: "completed" }),
    expected: { kind: "email", template: "closed", params: { reason: "fixed" } },
  },
  {
    name: "closed with no reason",
    event: payload("closed", { state: "closed" }),
    expected: { kind: "email", template: "closed", params: { reason: "fixed" } },
  },
  {
    name: "closed as not planned",
    event: payload("closed", { state: "closed", reason: "not_planned" }),
    expected: { kind: "email", template: "closed", params: { reason: "rejected" } },
  },
  {
    name: "closed as a duplicate",
    event: payload("closed", { state: "closed", reason: "duplicate" }),
    expected: { kind: "email", template: "closed", params: { reason: "duplicate" } },
  },
  {
    name: "reopened",
    event: payload("reopened"),
    expected: { kind: "email", template: "reopened", params: {} },
  },
  {
    name: "a notify Status entered while open",
    event: payload("labeled", { label: "status:in-progress" }),
    expected: { kind: "email", template: "statusEntered", params: { status: "Folyamatban" } },
  },
  {
    name: "a second notify Status at once is its own email",
    event: payload("labeled", { label: "status:on-hold" }),
    expected: { kind: "email", template: "statusEntered", params: { status: "Várakozik" } },
  },
  // Everything else sends nothing
  {
    name: "a Status without notify",
    event: payload("labeled", { label: "status:scheduled" }),
    expected: { kind: "ignore", why: "no-major-change" },
  },
  {
    name: "a Status label the configuration does not know",
    event: payload("labeled", { label: "status:gone" }),
    expected: { kind: "ignore", why: "no-major-change" },
  },
  {
    name: "a Priority label",
    event: payload("labeled", { label: "priority:high" }),
    expected: { kind: "ignore", why: "no-major-change" },
  },
  {
    name: "a Category label",
    event: payload("labeled", { label: "category:elevator" }),
    expected: { kind: "ignore", why: "no-major-change" },
  },
  {
    name: "a label that is not ours",
    event: payload("labeled", { label: "wontfix" }),
    expected: { kind: "ignore", why: "no-major-change" },
  },
  {
    name: "the unlabeled of a dashboard close",
    event: payload("unlabeled", { state: "closed", label: "status:in-progress" }),
    expected: { kind: "ignore", why: "no-major-change" },
  },
  {
    name: "an unlabeled while open",
    event: payload("unlabeled", { label: "status:in-progress" }),
    expected: { kind: "ignore", why: "no-major-change" },
  },
  ...["opened", "edited", "assigned", "unassigned"].map((action): Case => ({
    name: action,
    event: payload(action),
    expected: { kind: "ignore", why: "no-major-change" },
  })),
];

describe("classifyIssuesEvent (SPEC 4.2)", () => {
  it.each(cases)("$name", ({ event, expected }) => {
    expect(classifyIssuesEvent(event, config.taxonomy, bot)).toEqual(expected);
  });

  it("keys on the Status flags, never the names", () => {
    const renamed = structuredClone(config.taxonomy);
    renamed.status = [
      { id: "alpha", name: "In progress", color: "ffffff", initial: true, notify: false },
      { id: "beta", name: "Done-ish", color: "ffffff", initial: false, notify: true },
    ];
    expect(classifyIssuesEvent(payload("labeled", { label: "status:beta" }), renamed, bot)).toEqual(
      {
        kind: "email",
        template: "statusEntered",
        params: { status: "Done-ish" },
      },
    );
    expect(
      classifyIssuesEvent(payload("labeled", { label: "status:alpha" }), renamed, bot),
    ).toEqual({ kind: "ignore", why: "initial" });
  });

  it("a person with the Bot's login but another id is not the Bot", () => {
    const imposter = { login: bot.login, id: 1, type: "User" };
    expect(
      classifyIssuesEvent(payload("reopened", { sender: imposter }), config.taxonomy, bot).kind,
    ).toBe("email");
  });
});
