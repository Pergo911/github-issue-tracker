import { describe, expect, it } from "vitest";
import { buildReporterComment, classifyComment, type ExpectedBot } from "./attribution.ts";

const bot: ExpectedBot = { login: "fault-reports-bot[bot]", id: 9001, type: "Bot", appId: 424242 };

function comment(
  overrides: {
    body?: string;
    user?: Partial<{ login: string; id: number; type: string }>;
    app?: { id: number } | null;
  } = {},
) {
  return {
    body: overrides.body ?? buildReporterComment("Még mindig nem működik."),
    user: { login: bot.login, id: bot.id, type: "Bot", ...overrides.user },
    performed_via_github_app: overrides.app ?? null,
  };
}

describe("buildReporterComment (SPEC 4.3)", () => {
  it("is the fixed marker, a blank line and the canonical fence", () => {
    expect(buildReporterComment("hello")).toBe("**Reporter:**\n\n```\nhello\n```");
  });

  it("widens the fence past any backtick run in the text", () => {
    expect(buildReporterComment("a ``` b")).toBe("**Reporter:**\n\n````\na ``` b\n````");
  });
});

describe("classifyComment (SPEC 4.3)", () => {
  it("a Bot comment with the canonical envelope is the Reporter's, decoded", () => {
    expect(classifyComment(comment(), bot)).toEqual({
      author: "reporter",
      text: "Még mindig nem működik.",
    });
  });

  it("round-trips text that contains fences, markers and entities", () => {
    const text = "```\n**Reporter:**\n&lt;b&gt; ````";
    expect(classifyComment(comment({ body: buildReporterComment(text) }), bot)).toEqual({
      author: "reporter",
      text,
    });
  });

  it("accepts the expected GitHub App on the comment", () => {
    expect(classifyComment(comment({ app: { id: 424242 } }), bot).author).toBe("reporter");
  });

  it("conflicting App metadata fails closed: Staff, as plain text", () => {
    const body = buildReporterComment("x");
    expect(classifyComment(comment({ body, app: { id: 1 } }), bot)).toEqual({
      author: "staff",
      text: body,
    });
  });

  it.each([
    ["another login", { login: "someone-else" }],
    ["another numeric id", { id: 1 }],
    ["a User type with the Bot's login and id", { type: "User" }],
  ])("a Staff-authored lookalike (%s) stays Staff", (_name, user) => {
    const body = buildReporterComment("I am the reporter");
    expect(classifyComment(comment({ body, user }), bot)).toEqual({ author: "staff", text: body });
  });

  it("a Bot comment that is not exactly canonical is Staff, as plain text", () => {
    for (const body of [
      "**Reporter:**\n\n```\nhello\n```\n",
      "**Reporter:**\n\n``\nhello\n``",
      "**Reporter:** hello",
      "**Reporter:**\n\n```\nhello",
      "plain",
    ]) {
      expect(classifyComment(comment({ body }), bot)).toEqual({ author: "staff", text: body });
    }
  });
});
