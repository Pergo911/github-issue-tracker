import { describe, expect, it } from "vitest";
import { en, hu } from "@shared/i18n/index.ts";
import { PSEUDO_MARK_START } from "@shared/i18n/pseudo.ts";
import { selectCatalog } from "./select-catalog.ts";

describe("selectCatalog", () => {
  it("uses the configured language's catalog", () => {
    expect(selectCatalog({ language: "hu", search: "", pseudoEnabled: false })).toBe(hu);
    expect(selectCatalog({ language: "en", search: "", pseudoEnabled: false })).toEqual(en);
  });

  it("uses English while the language is not known yet, which is when the boot screens show", () => {
    expect(selectCatalog({ language: undefined, search: "", pseudoEnabled: false })).toEqual(en);
  });

  it("offers the pseudo-language only where a test server enabled it", () => {
    const enabled = selectCatalog({ language: "hu", search: "?lang=pseudo", pseudoEnabled: true });
    expect(enabled["boot.retry"]?.startsWith(PSEUDO_MARK_START)).toBe(true);
    const disabled = selectCatalog({ language: "hu", search: "?lang=pseudo", pseudoEnabled: false });
    expect(disabled).toBe(hu);
  });

  it("applies the pseudo-language to the boot screens too, before any language is known", () => {
    const catalog = selectCatalog({ language: undefined, search: "?lang=pseudo", pseudoEnabled: true });
    expect(catalog["boot.loading"]?.startsWith(PSEUDO_MARK_START)).toBe(true);
  });
});
