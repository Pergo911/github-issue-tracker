import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  MAX_DESCRIPTION,
  MAX_PLACE,
  MAX_TITLE,
  MIN_TITLE,
  TITLE_ALPHABET,
  normalizeEmail,
  normalizeTitle,
  collectErrors,
  validateFields,
  type FieldError,
} from "./validate.ts";

const taxonomy = { categories: ["plumbing", "elevator"], locations: ["basement", "roof"] };
const valid = {
  category: "plumbing",
  location: "basement",
  title: "Leaking pipe in the cellar",
  description: "Water is dripping.",
};

function error(overrides: Record<string, unknown>): FieldError | null {
  const result = validateFields({ ...valid, ...overrides }, taxonomy);
  return result.ok ? null : result.error;
}

describe("normalizing a title (SPEC 4.1)", () => {
  it("trims, and collapses internal newlines to single spaces", () => {
    expect(normalizeTitle("  Leak \n in\r\n\r\nthe cellar  ")).toBe("Leak in the cellar");
  });

  it("is idempotent", () => {
    fc.assert(
      fc.property(fc.string(), (raw) => {
        expect(normalizeTitle(normalizeTitle(raw))).toBe(normalizeTitle(raw));
      }),
    );
  });
});

describe("validating the form fields", () => {
  it("accepts a valid report and returns the normalized fields", () => {
    const result = validateFields(
      { ...valid, title: "  Hőszivattyú\nhiba ", place: "  B lépcsőház  " },
      taxonomy,
    );
    expect(result).toEqual({
      ok: true,
      fields: {
        category: "plumbing",
        location: "basement",
        title: "Hőszivattyú hiba",
        description: "Water is dripping.",
        place: "B lépcsőház",
      },
    });
  });

  it("treats an empty Exact place as absent", () => {
    const result = validateFields({ ...valid, place: "   " }, taxonomy);
    expect(result.ok && result.fields.place).toBeUndefined();
  });

  it("enforces the title length after normalization", () => {
    expect(error({ title: "ab" })).toBe("title_length");
    expect(error({ title: "   a  " })).toBe("title_length");
    expect(error({ title: "abc" })).toBeNull();
    expect(error({ title: "a".repeat(MAX_TITLE) })).toBeNull();
    expect(error({ title: "a".repeat(MAX_TITLE + 1) })).toBe("title_length");
    // Newlines collapse first, so they do not count as extra characters
    expect(error({ title: `${"a".repeat(39)}\n${"b".repeat(40)}` })).toBeNull();
  });

  it("enforces the description and Exact place limits", () => {
    expect(error({ description: "   " })).toBe("description_length");
    expect(error({ description: "x".repeat(MAX_DESCRIPTION) })).toBeNull();
    expect(error({ description: "x".repeat(MAX_DESCRIPTION + 1) })).toBe("description_length");
    expect(error({ place: "x".repeat(MAX_PLACE) })).toBeNull();
    expect(error({ place: "x".repeat(MAX_PLACE + 1) })).toBe("place_length");
  });

  it("only accepts configured Category and Location values", () => {
    expect(error({ category: "nope" })).toBe("unknown_category");
    expect(error({ location: "nope" })).toBe("unknown_location");
  });

  it("rejects characters outside the title alphabet instead of stripping them", () => {
    for (const bad of [
      "Fix `this`",
      "mention @bob",
      "ref #12",
      "<b>bold</b>",
      "a: b",
      "a/b",
      "fire 🔥",
      "tab\there",
      "a_b",
      "a*b",
      "a[b]",
    ]) {
      expect(error({ title: bad }), bad).toBe("title_characters");
    }
    for (const good of [
      "Ablak (3. emelet) – törött",
      "It's “fine”, isn't it?",
      "Lift 2-es!",
      "‘x’ — y.",
      // Hungarian quotation marks and the ellipsis: live GitHub renders them as plain text (ticket #32).
      "Hiba „idézet” után",
      "Hiba ‚idézet’ után",
      "Hiba »idézet« után",
      "Várjuk… sokáig",
    ]) {
      expect(error({ title: good }), good).toBeNull();
    }
  });

  it("property: an accepted title is stored unchanged, one line, in length, in the alphabet", () => {
    fc.assert(
      fc.property(fc.string({ unit: "binary" }), (raw) => {
        const result = validateFields({ ...valid, title: raw }, taxonomy);
        if (!result.ok) return;
        const title = result.fields.title;
        expect(title).toBe(normalizeTitle(raw));
        expect(title).not.toMatch(/[\r\n]/);
        expect([...title].length).toBeGreaterThanOrEqual(MIN_TITLE);
        expect([...title].length).toBeLessThanOrEqual(MAX_TITLE);
        expect(title).toMatch(TITLE_ALPHABET);
      }),
      { numRuns: 500 },
    );
  });

  it("property: any title containing a character outside the alphabet is rejected", () => {
    const forbidden = fc.constantFrom(..."`@#<>:/\\_*[]{}|~$%^&=+;\t🔥​".split(""));
    fc.assert(
      fc.property(fc.stringMatching(/^[a-z]{3,20}$/), forbidden, fc.nat(), (base, char, at) => {
        const index = 1 + (at % (base.length - 1));
        const title = base.slice(0, index) + char + base.slice(index);
        expect(validateFields({ ...valid, title }, taxonomy).ok).toBe(false);
      }),
    );
  });
});

describe("collecting every problem for the form", () => {
  it("reports one code per field, all at once", () => {
    expect(
      collectErrors(
        { category: "", location: "", title: "a`", description: "", place: "x".repeat(101) },
        taxonomy,
      ),
    ).toEqual({
      category: "unknown_category",
      location: "unknown_location",
      title: "title_length",
      description: "description_length",
      place: "place_length",
    });
    expect(collectErrors({ ...valid, title: "Bad `title`" }, taxonomy)).toEqual({
      title: "title_characters",
    });
    expect(collectErrors(valid, taxonomy)).toEqual({});
  });
});

describe("normalizing an email", () => {
  it("trims and lowercases, without folding dots or +tags", () => {
    expect(normalizeEmail("  Anna.Kiss+x@Example.HU ")).toBe("anna.kiss+x@example.hu");
  });
});
