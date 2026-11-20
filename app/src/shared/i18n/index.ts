import type { Language } from "../config/schema.ts";
import { en } from "./en.ts";
import { hu } from "./hu.ts";
import type { PartialCatalog } from "./translate.ts";

export { en } from "./en.ts";
export { createFormatter, type Formatter } from "./format.ts";
export { hu } from "./hu.ts";
export {
  createTranslator,
  placeholdersOf,
  type MessageKey,
  type PartialCatalog,
  type Translator,
} from "./translate.ts";

const catalogs: Record<Language, PartialCatalog> = { en, hu };

/** The catalog for a configured language. Unknown languages never get here: the config schema maps them to en. */
export function catalogFor(language: Language): PartialCatalog {
  return catalogs[language];
}
