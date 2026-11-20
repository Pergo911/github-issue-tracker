import { describe, expect, it } from "vitest";
import { catalogFor, createTranslator } from "../i18n/index.ts";
import { buildReportBody, correlationMarker } from "./body.ts";

const hu = createTranslator(catalogFor("hu"));
const en = createTranslator(catalogFor("en"));

describe("the issue body template (SPEC 4.1, 4.3)", () => {
  it("writes the catalog captions, display names, fenced Reporter text and the marker outside the fences", () => {
    const body = buildReportBody({
      t: en,
      categoryName: "Lift",
      locationName: "Stairwell",
      place: "B staircase, 2nd door",
      description: "It stops between floors.\n```\nnot a fence",
      marker: "m4rker",
    });
    expect(body).toBe(
      [
        "**Category:** Lift",
        "**Location:** Stairwell",
        "",
        "**Exact place:**",
        "```",
        "B staircase, 2nd door",
        "```",
        "",
        "**Description:**",
        "````",
        "It stops between floors.",
        "```",
        "not a fence",
        "````",
        "",
        "<!-- fault-report-attempt: m4rker -->",
      ].join("\n"),
    );
  });

  it("leaves out the Exact place section when there is none, and uses the configured language", () => {
    const body = buildReportBody({
      t: hu,
      categoryName: "Lift",
      locationName: "Lépcsőház",
      description: "Elakadt.",
      marker: "abc",
    });
    expect(body).toBe(
      [
        "**Kategória:** Lift",
        "**Helyszín:** Lépcsőház",
        "",
        "**Leírás:**",
        "```",
        "Elakadt.",
        "```",
        "",
        "<!-- fault-report-attempt: abc -->",
      ].join("\n"),
    );
  });

  it("builds the marker line that a recovery scan searches for", () => {
    expect(correlationMarker("abc")).toBe("<!-- fault-report-attempt: abc -->");
  });
});
