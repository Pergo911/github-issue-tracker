import { en } from "./en.ts";
import type { MessageKey, PartialCatalog } from "./translate.ts";

export const PSEUDO_MARK_START = "«";
export const PSEUDO_MARK_END = "»";

/**
 * The test-only pseudo-language: every catalog string wrapped in marks. The end-to-end sweep loads the app
 * in it and fails on any visible text or accessible name that lacks the marks, which is how it catches
 * English that bypassed the catalog, shadcn's built-in strings included. Never offered as a language.
 */
export function pseudo(): Record<MessageKey, string> & PartialCatalog {
  const marked = {} as Record<MessageKey, string>;
  for (const key of Object.keys(en) as MessageKey[]) {
    marked[key] = `${PSEUDO_MARK_START}${en[key]}${PSEUDO_MARK_END}`;
  }
  return marked;
}
