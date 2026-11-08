import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { en } from "./en.ts";
import { createFormatter } from "./format.ts";
import { hu } from "./hu.ts";
import { catalogFor } from "./index.ts";
import { pseudo, PSEUDO_MARK_END, PSEUDO_MARK_START } from "./pseudo.ts";
import { createTranslator, placeholdersOf } from "./translate.ts";

describe("catalogs", () => {
  it("define every key in hu: a missing Hungarian string fails here, not in front of a Reporter", () => {
    const missing = Object.keys(en).filter((key) => !(key in hu));
    expect(missing).toEqual([]);
  });

  it("have no hu key that en does not define", () => {
    const unknown = Object.keys(hu).filter((key) => !(key in en));
    expect(unknown).toEqual([]);
  });

  it("use the same placeholders in hu as in en", () => {
    for (const key of Object.keys(en) as (keyof typeof en)[]) {
      const translated = (hu as Record<string, string>)[key];
      expect(placeholdersOf(translated ?? "").sort(), key).toEqual(placeholdersOf(en[key]).sort());
    }
  });

  it("never leave a string empty", () => {
    for (const [key, text] of [...Object.entries(en), ...Object.entries(hu)]) {
      expect(text.trim(), key).not.toBe("");
    }
  });

  it("select the catalog by language and fall back to en for anything unknown", () => {
    expect(catalogFor("hu")).toBe(hu);
    expect(catalogFor("en")).toEqual(en);
  });
});

describe("translator", () => {
  it("returns the configured language's string", () => {
    const t = createTranslator({ "boot.retry": "Próbálja újra" });
    expect(t("boot.retry")).toBe("Próbálja újra");
  });

  it("falls back to English per key when the catalog lacks it", () => {
    const t = createTranslator({});
    expect(t("boot.retry")).toBe(en["boot.retry"]);
  });

  it("fills typed {name} placeholders", () => {
    const t = createTranslator({ "header.homeLink": "{organization}: kezdőlap" });
    expect(t("header.homeLink", { organization: "Rózsa Társasház" })).toBe("Rózsa Társasház: kezdőlap");
  });

  it("rejects missing and unknown placeholders at compile time", () => {
    const t = createTranslator({});
    // @ts-expect-error a placeholder is required
    t("header.homeLink");
    // @ts-expect-error the placeholder is called organization
    t("header.homeLink", { name: "x" });
    // @ts-expect-error this key has no placeholders
    t("boot.retry", { organization: "x" });
  });

  it("substitutes in one pass: a value that looks like a placeholder stays text", () => {
    const t = createTranslator({});
    expect(t("header.homeLink", { organization: "{organization} {x}" })).toBe(
      "{organization} {x}: home page",
    );
  });

  it("round-trips any value into the placeholder position", () => {
    const t = createTranslator({});
    fc.assert(
      fc.property(fc.string({ unit: "grapheme" }), (organization) => {
        expect(t("header.homeLink", { organization })).toBe(`${organization}: home page`);
      }),
    );
  });
});

describe("formatter", () => {
  const instant = (iso: string) => new Date(iso);

  it("renders the clock of the configured time zone, winter and summer", () => {
    const budapest = createFormatter({ language: "hu", timezone: "Europe/Budapest" });
    expect(budapest.dateTime(instant("2026-01-15T12:00:00Z"))).toContain("13:00");
    expect(budapest.dateTime(instant("2026-07-15T12:00:00Z"))).toContain("14:00");
    const utc = createFormatter({ language: "hu", timezone: "UTC" });
    expect(utc.dateTime(instant("2026-01-15T12:00:00Z"))).toContain("12:00");
  });

  it("moves the date across midnight with the time zone", () => {
    const budapest = createFormatter({ language: "en", timezone: "Europe/Budapest" });
    const utc = createFormatter({ language: "en", timezone: "UTC" });
    const lateEvening = instant("2026-03-10T23:30:00Z");
    expect(budapest.date(lateEvening)).not.toBe(utc.date(lateEvening));
  });

  it("uses the language's conventions", () => {
    const hungarian = createFormatter({ language: "hu", timezone: "UTC" }).date(instant("2026-03-10T12:00:00Z"));
    const english = createFormatter({ language: "en", timezone: "UTC" }).date(instant("2026-03-10T12:00:00Z"));
    expect(hungarian).toContain("2026");
    expect(hungarian).not.toBe(english);
  });
});

describe("pseudo-language", () => {
  it("marks every string of every key, so a sweep can tell catalog text from stray literals", () => {
    const catalog = pseudo();
    for (const key of Object.keys(en) as (keyof typeof en)[]) {
      const text = catalog[key];
      expect(text.startsWith(PSEUDO_MARK_START), key).toBe(true);
      expect(text.endsWith(PSEUDO_MARK_END), key).toBe(true);
    }
  });

  it("keeps the placeholders working", () => {
    const t = createTranslator(pseudo());
    expect(t("header.homeLink", { organization: "X" })).toContain("X");
  });
});
