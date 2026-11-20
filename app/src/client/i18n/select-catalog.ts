import type { Language } from "@shared/config/schema.ts";
import { catalogFor, en, type PartialCatalog } from "@shared/i18n/index.ts";
import { pseudo } from "@shared/i18n/pseudo.ts";

export interface CatalogSelection {
  /** The configured language, or `undefined` before the configuration has loaded (the boot screens). */
  language: Language | undefined;
  /** `window.location.search`. */
  search: string;
  /** True only in a build made for the end-to-end suite (`VITE_PSEUDO=1`). */
  pseudoEnabled: boolean;
}

/**
 * Which catalog the SPA renders in. There is no per-user language (SPEC 2.5): the configured language,
 * or English before the configuration is known. The pseudo-language is the exception, a test-only catalog
 * (`?lang=pseudo`) that exists only in a build that enabled it.
 */
export function selectCatalog({
  language,
  search,
  pseudoEnabled,
}: CatalogSelection): PartialCatalog {
  if (pseudoEnabled && new URLSearchParams(search).get("lang") === "pseudo") return pseudo();
  return language === undefined ? en : catalogFor(language);
}
