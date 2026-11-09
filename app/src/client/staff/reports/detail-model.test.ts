import { describe, expect, it } from "vitest";
import { configSchema } from "@shared/config/schema.ts";
import { referenceConfig } from "@shared/seed/reference-config.ts";
import type { GitHubIssue, GitHubTimelineEvent } from "@shared/github/types.ts";
import { catalogFor, createTranslator } from "@shared/i18n/index.ts";
import { buildReporterComment } from "@shared/reports/attribution.ts";
import { buildReportBody } from "@shared/reports/body.ts";
import { toReportDetail } from "./detail-model.ts";

const taxonomy = configSchema.parse(referenceConfig).taxonomy;
const bot = { login: "reports[bot]", id: 900, type: "Bot" as const };
const botUser = { login: bot.login, id: bot.id, type: "Bot" };
const staffUser = { login: "mate", id: 5, type: "User" };

const canonical = buildReportBody({
  t: createTranslator(catalogFor("en")),
  categoryName: "Elevator",
  locationName: "Stairwell",
  place: "Rear lift",
  description: "It stops.\n```\nnot a fence",
  marker: "abcdefghijklmnopqrstuv",
});

function issue(overrides: Record<string, unknown> = {}): GitHubIssue {
  return {
    number: 7,
    title: "Stuck lift",
    body: canonical,
    state: "open",
    state_reason: null,
    created_at: "2026-06-01T08:00:00Z",
    updated_at: "2026-06-02T08:00:00Z",
    closed_at: null,
    user: botUser,
    labels: [{ name: "category:elevator" }, { name: "priority:high" }, { name: "status:new" }],
    assignees: [{ login: "mate" }],
    ...overrides,
  } as unknown as GitHubIssue;
}

const comment = (body: string, user: object, at = "2026-06-01T09:00:00Z") =>
  ({
    event: "commented",
    body,
    user,
    created_at: at,
    performed_via_github_app: null,
  }) as unknown as GitHubTimelineEvent;

describe("toReportDetail", () => {
  it("decodes the body from its canonical envelopes", () => {
    const detail = toReportDetail(issue(), [], taxonomy, bot);
    expect(detail.body).toEqual({
      kind: "report",
      place: "Rear lift",
      description: "It stops.\n```\nnot a fence",
    });
  });

  it("keeps a body that is not canonical as plain text", () => {
    const detail = toReportDetail(issue({ body: "**Place:** edited by hand" }), [], taxonomy, bot);
    expect(detail.body).toEqual({ kind: "plain", text: "**Place:** edited by hand" });
  });

  it("tells a Reporter comment from a Staff lookalike by the Bot identity, and names the Staff author", () => {
    const detail = toReportDetail(
      issue(),
      [
        comment(buildReporterComment("Still broken"), botUser),
        comment(buildReporterComment("Faked"), staffUser, "2026-06-01T10:00:00Z"),
        comment("On my way", staffUser, "2026-06-01T11:00:00Z"),
      ],
      taxonomy,
      bot,
    );
    expect(detail.timeline).toMatchObject([
      { kind: "comment", author: "reporter", text: "Still broken" },
      { kind: "comment", author: "staff", login: "mate" },
      { kind: "comment", author: "staff", login: "mate", text: "On my way" },
    ]);
    expect(detail.timeline[0]).not.toHaveProperty("login");
  });

  it("reads the classification, the assignees and an invalid Status off the labels", () => {
    const detail = toReportDetail(
      issue({ labels: [{ name: "status:new" }, { name: "status:in-progress" }] }),
      [],
      taxonomy,
      bot,
    );
    expect(detail.row).toMatchObject({
      assignees: ["mate"],
      status: null,
      statusProblem: "multiple",
    });
  });

  it("carries the close reason of a closed Report", () => {
    const detail = toReportDetail(
      issue({ state: "closed", state_reason: "duplicate", closed_at: "2026-06-03T08:00:00Z" }),
      [],
      taxonomy,
      bot,
    );
    expect(detail.closeReason).toBe("duplicate");
    expect(detail.closedAt).toBe("2026-06-03T08:00:00Z");
  });
});
