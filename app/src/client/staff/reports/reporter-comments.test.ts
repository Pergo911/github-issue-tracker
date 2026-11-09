import { describe, expect, it } from "vitest";
import type { GitHubComment } from "@shared/github/types.ts";
import { buildReporterComment } from "@shared/reports/attribution.ts";
import { scanReporterComments } from "./reporter-comments.ts";

const bot = { login: "reports-bot[bot]", id: 77, type: "Bot" as const };
const botUser = { login: bot.login, id: bot.id, type: "Bot" };
const member = { login: "maintenance", id: 5, type: "User" };

function comment(
  issue: number,
  body: string,
  at: string,
  user: { login: string; id: number; type: string } = botUser,
): GitHubComment {
  return {
    id: Math.floor(Math.random() * 1e9),
    issue_url: `https://api.github.com/repos/o/r/issues/${issue}`,
    body,
    created_at: at,
    user,
  } as unknown as GitHubComment;
}

describe("scanReporterComments", () => {
  it("groups the Bot's canonical Reporter comments by issue, with the count and the latest time", () => {
    const scan = scanReporterComments(
      [
        comment(3, buildReporterComment("egy"), "2026-03-01T10:00:00Z"),
        comment(3, buildReporterComment("kettő"), "2026-03-04T10:00:00Z"),
        comment(8, buildReporterComment("három"), "2026-03-02T10:00:00Z"),
      ],
      bot,
    );
    expect(scan).toEqual({
      3: { count: 2, last: "2026-03-04T10:00:00Z" },
      8: { count: 1, last: "2026-03-02T10:00:00Z" },
    });
  });

  it("keeps the latest time whatever the order of the comments", () => {
    const scan = scanReporterComments(
      [
        comment(3, buildReporterComment("a"), "2026-03-04T10:00:00Z"),
        comment(3, buildReporterComment("b"), "2026-03-01T10:00:00Z"),
      ],
      bot,
    );
    expect(scan[3]?.last).toBe("2026-03-04T10:00:00Z");
  });

  it("ignores Staff comments, lookalikes written by a member and an edited envelope", () => {
    const scan = scanReporterComments(
      [
        comment(1, "Köszönjük, jövünk.", "2026-03-01T10:00:00Z", member),
        comment(1, buildReporterComment("hamis"), "2026-03-01T11:00:00Z", member),
        comment(1, `${buildReporterComment("szerkesztett")}\nmegtoldva`, "2026-03-01T12:00:00Z"),
        comment(1, "A Bot egyéb megjegyzése", "2026-03-01T13:00:00Z"),
      ],
      bot,
    );
    expect(scan).toEqual({});
  });

  it("ignores a comment whose issue it cannot place", () => {
    const odd = {
      ...comment(1, buildReporterComment("x"), "2026-03-01T10:00:00Z"),
      issue_url: "?",
    };
    expect(scanReporterComments([odd as GitHubComment], bot)).toEqual({});
  });
});
