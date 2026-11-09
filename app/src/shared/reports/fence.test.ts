import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { decodeFence, encodeFence, fenceFor } from "./fence.ts";

describe("the canonical dynamic fence (SPEC 4.3)", () => {
  it("wraps text in three backticks when the text has no longer run", () => {
    expect(encodeFence("hello")).toBe("```\nhello\n```");
    expect(encodeFence("a ``b`` c")).toBe("```\na ``b`` c\n```");
  });

  it("is one backtick longer than the longest run in the text", () => {
    expect(fenceFor("```")).toBe("````");
    expect(fenceFor("x `````` y ``")).toBe("```````");
    expect(encodeFence("```\nbreak out")).toBe("````\n```\nbreak out\n````");
  });

  it("round-trips any text", () => {
    fc.assert(
      fc.property(fc.string({ unit: "binary" }), (text) => {
        expect(decodeFence(encodeFence(text))).toBe(text);
      }),
    );
    fc.assert(
      fc.property(fc.stringMatching(/^[`\n a]{0,40}$/), (text) => {
        expect(decodeFence(encodeFence(text))).toBe(text);
      }),
    );
  });

  it("lets no input close the fence early", () => {
    fc.assert(
      fc.property(fc.stringMatching(/^[`\n a~]{0,60}$/), (text) => {
        const fence = fenceFor(text);
        const longestRun = Math.max(0, ...(text.match(/`+/g) ?? []).map((run) => run.length));
        expect(fence.length).toBeGreaterThan(longestRun);
        expect(fence.length).toBeGreaterThanOrEqual(3);
        // No line of the body is a backtick run at least as long as the fence.
        for (const line of text.split("\n")) {
          expect(line.includes(fence)).toBe(false);
        }
      }),
    );
  });

  it("decodes only the exact canonical form", () => {
    for (const raw of [
      "",
      "plain text",
      "```\nno closing",
      "```\ntext\n```\ntrailing",
      "``\ntext\n``",
      "```js\ntext\n```",
      "````\ntext\n```",
      "```\ntext\n````",
      " ```\ntext\n```",
      "```\r\ntext\r\n```",
      "```\n```\nx\n```",
      "```\ntext```",
    ]) {
      expect(decodeFence(raw), JSON.stringify(raw)).toBeNull();
    }
  });

  it("requires re-encoding equality: a fence that is longer than needed is not canonical", () => {
    expect(decodeFence("````\ntext\n````")).toBeNull();
    expect(decodeFence("```\ntext\n```")).toBe("text");
  });

  it("keeps an empty text as an empty line", () => {
    expect(encodeFence("")).toBe("```\n\n```");
    expect(decodeFence("```\n\n```")).toBe("");
  });
});
