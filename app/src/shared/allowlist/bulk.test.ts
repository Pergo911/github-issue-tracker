import { describe, expect, it } from "vitest";
import { MAX_BULK_LINES, MAX_NOTE_LENGTH, normaliseEmail, parseBulk } from "./entries.ts";

describe("normaliseEmail", () => {
  it("trims and lowercases, and folds nothing else", () => {
    expect(normaliseEmail("  Anna.Kiss+Lift@Example.HU ")).toBe("anna.kiss+lift@example.hu");
  });

  it("returns null for text that is not an address", () => {
    for (const text of ["", "anna", "anna@", "@example.hu", "a b@example.hu", "a@b"]) {
      expect(normaliseEmail(text), text).toBeNull();
    }
  });

  it("returns null for an address longer than 254 characters", () => {
    expect(normaliseEmail(`${"a".repeat(250)}@example.hu`)).toBeNull();
  });
});

describe("parseBulk", () => {
  it("reads one address per line, with an optional note after a space, comma, semicolon or tab", () => {
    const result = parseBulk(
      [
        "anna@example.hu",
        "Bela@Example.hu Kovács Béla, 2/5",
        "csaba@example.hu, Nagy Csaba",
        "dora@example.hu;Dóra",
        "ede@example.hu\tEde",
      ].join("\n"),
    );
    expect(result.errors).toEqual([]);
    expect(result.entries).toEqual([
      { email: "anna@example.hu", line: 1 },
      { email: "bela@example.hu", note: "Kovács Béla, 2/5", line: 2 },
      { email: "csaba@example.hu", note: "Nagy Csaba", line: 3 },
      { email: "dora@example.hu", note: "Dóra", line: 4 },
      { email: "ede@example.hu", note: "Ede", line: 5 },
    ]);
  });

  it("skips blank lines but reports errors against the line's real number", () => {
    const result = parseBulk("anna@example.hu\n\n   \nnot-an-address\r\nbela@example.hu");
    expect(result.entries.map((entry) => entry.email)).toEqual([
      "anna@example.hu",
      "bela@example.hu",
    ]);
    expect(result.errors).toEqual([{ line: 4, text: "not-an-address", code: "invalid_email" }]);
  });

  it("drops a repeated address, keeping the first, and says so", () => {
    const result = parseBulk("anna@example.hu First\nANNA@example.hu Second");
    expect(result.entries).toEqual([{ email: "anna@example.hu", note: "First", line: 1 }]);
    expect(result.errors).toEqual([{ line: 2, text: "ANNA@example.hu Second", code: "duplicate" }]);
  });

  it("rejects a note over the limit", () => {
    const result = parseBulk(`anna@example.hu ${"x".repeat(MAX_NOTE_LENGTH + 1)}`);
    expect(result.entries).toEqual([]);
    expect(result.errors[0]?.code).toBe("note_too_long");
  });

  it("counts the non-blank lines against the 500 limit", () => {
    const lines = Array.from({ length: MAX_BULK_LINES + 1 }, (_, i) => `u${i}@example.hu`);
    expect(parseBulk(lines.join("\n")).tooMany).toBe(true);
    expect(parseBulk(lines.slice(0, MAX_BULK_LINES).join("\n\n")).tooMany).toBe(false);
  });
});
