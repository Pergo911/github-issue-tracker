import { en } from "./en.ts";

/**
 * The hand-written translator (SPEC 2.5): no i18n library, so the SPA and the Worker behave identically.
 * Plurals are not handled; Hungarian does not pluralize after numerals, and a language that needs it
 * adds function-valued entries then.
 */

export type MessageKey = keyof typeof en;
/** A catalog for any language: `en` is complete, the rest are partial and fall back to `en` per key. */
export type PartialCatalog = Readonly<Partial<Record<MessageKey, string>>>;

/** The placeholder names of a string type: `"{a} and {b}"` gives `"a" | "b"`. */
type PlaceholderName<S extends string> = S extends `${string}{${infer Name}}${infer Rest}`
  ? Name | PlaceholderName<Rest>
  : never;

type Params<K extends MessageKey> = [PlaceholderName<(typeof en)[K]>] extends [never]
  ? []
  : [params: Record<PlaceholderName<(typeof en)[K]>, string | number>];

export type Translator = <K extends MessageKey>(key: K, ...params: Params<K>) => string;

/** The placeholder names found in a string at runtime. */
export function placeholdersOf(text: string): string[] {
  return [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1] ?? "");
}

export function createTranslator(catalog: PartialCatalog): Translator {
  return (key, ...args) => {
    const template: string = catalog[key] ?? en[key];
    const params = args[0] as Record<string, string | number> | undefined;
    if (!params) return template;
    // One pass over the template, so a value that looks like a placeholder is left as text.
    return template.replace(/\{(\w+)\}/g, (match, name: string) =>
      Object.hasOwn(params, name) ? String(params[name]) : match,
    );
  };
}
