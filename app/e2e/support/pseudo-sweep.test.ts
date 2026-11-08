import { describe, expect, it } from "vitest";
import {
  PSEUDO_MARK_END as end,
  PSEUDO_MARK_START as start,
} from "../../src/shared/i18n/pseudo.ts";
import { findUnmarked, namesFromAriaSnapshot } from "./pseudo-sweep.ts";

describe("findUnmarked", () => {
  it("passes text that comes from the pseudo catalog", () => {
    expect(findUnmarked([`${start}Submit a report${end}`])).toEqual([]);
  });

  it("fails visible text that bypassed the catalog", () => {
    expect(findUnmarked([`${start}Submit a report${end}`, "Close"])).toEqual(["Close"]);
  });

  it("fails a catalog string with a literal glued on, because the literal is the leak", () => {
    expect(findUnmarked([`${start}Back${end} to start`])).toEqual([" to start".trim()]);
  });

  it("ignores strings with no letters in them: numbers, symbols and the neutral loading title", () => {
    expect(findUnmarked(["…", "12", "#7 · 3", "—"])).toEqual([]);
  });

  it("lets a screen name the text that is data, not catalog: the Organization's name, a Report's title", () => {
    expect(findUnmarked(["Rózsa Társasház"], ["Rózsa Társasház"])).toEqual([]);
    expect(findUnmarked(["Rózsa Társasház", "Close"], ["Rózsa Társasház"])).toEqual(["Close"]);
    expect(findUnmarked(["Report #14: Leaking pipe"], [/Report #\d+: .+/])).toEqual([]);
  });

  it("lets data sit next to catalog text, as in a tab title", () => {
    expect(
      findUnmarked([`${start}Staff sign-in${end} – Rózsa Társasház`], ["Rózsa Társasház"]),
    ).toEqual([]);
  });

  it("reports each leak once, trimmed", () => {
    expect(findUnmarked(["  Close ", "Close", "Close"])).toEqual(["Close"]);
  });
});

describe("namesFromAriaSnapshot", () => {
  const snapshot = [
    "- banner:",
    '  - link "Rózsa Társasház: kezdőlap":',
    "    - /url: /",
    "    - text: Rózsa Társasház",
    "- main:",
    '  - heading "Hibabejelentés" [level=1]',
    "  - paragraph: Jelentsen be egy hibát",
    '  - button "Say \\"hi\\"" [disabled]',
  ].join("\n");

  it("collects accessible names, inline text and text nodes, and nothing else", () => {
    expect(namesFromAriaSnapshot(snapshot)).toEqual([
      "Rózsa Társasház: kezdőlap",
      "Rózsa Társasház",
      "Hibabejelentés",
      "Jelentsen be egy hibát",
      'Say "hi"',
    ]);
  });
});
