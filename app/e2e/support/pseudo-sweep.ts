import type { Page } from "@playwright/test";
import { PSEUDO_MARK_END, PSEUDO_MARK_START } from "../../src/shared/i18n/pseudo.ts";

/** Text a screen may show that is data rather than catalog wording: a name, a Report's title, a date. */
export type AllowedText = string | RegExp;

const HAS_LETTER = /\p{L}/u;
const MARKED = new RegExp(`${PSEUDO_MARK_START}[^${PSEUDO_MARK_END}]*${PSEUDO_MARK_END}`, "gu");

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Of the given visible texts and accessible names, those that do not come from the catalog.
 * Run against the app in the pseudo-language, where every catalog string is wrapped in marks: whatever
 * letters remain once the marked segments and the screen's declared data are removed is English (or any text)
 * that bypassed the catalog, shadcn's built-in strings included.
 */
export function findUnmarked(
  strings: readonly string[],
  allowed: readonly AllowedText[] = [],
): string[] {
  const leaks = new Set<string>();
  for (const original of strings) {
    let rest = original.replace(MARKED, " ");
    for (const item of allowed) {
      const pattern =
        typeof item === "string" ? new RegExp(escapeRegExp(item), "g") : new RegExp(item, "g");
      rest = rest.replace(pattern, " ");
    }
    if (HAS_LETTER.test(rest)) leaks.add(rest.trim() === "" ? original.trim() : rest.trim());
  }
  return [...leaks];
}

/** Accessible names and text from Playwright's ARIA snapshot (the computed names, labelledby and svg titles included). */
export function namesFromAriaSnapshot(snapshot: string): string[] {
  const unescape = (text: string) => text.replace(/\\(.)/g, "$1");
  const found: string[] = [];
  for (const line of snapshot.split("\n")) {
    const named = /^\s*- [\w-]+ "((?:[^"\\]|\\.)*)"/.exec(line);
    if (named?.[1] !== undefined) {
      found.push(unescape(named[1]));
      continue;
    }
    const inline = /^\s*- (?:text|[\w-]+): (.+)$/.exec(line);
    if (inline?.[1] !== undefined) found.push(inline[1]);
  }
  return found;
}

/** Everything a user or a screen reader can read on the page right now. */
export async function collectReadableStrings(page: Page): Promise<string[]> {
  const fromDom = await page.evaluate(() => {
    const strings: string[] = [document.title];
    const skip = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE"]);
    const attributes = [
      "aria-label",
      "aria-description",
      "aria-roledescription",
      "aria-valuetext",
      "aria-placeholder",
      "title",
      "alt",
      "placeholder",
    ];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const parent = node.parentElement;
      const text = node.textContent?.trim();
      if (!parent || !text || skip.has(parent.tagName)) continue;
      if (!parent.checkVisibility({ visibilityProperty: true })) continue;
      strings.push(text);
    }
    for (const element of document.body.querySelectorAll("*")) {
      for (const name of attributes) {
        const value = element.getAttribute(name);
        if (value) strings.push(value);
      }
      if (
        element instanceof HTMLInputElement &&
        ["submit", "button", "reset"].includes(element.type)
      ) {
        strings.push(element.value);
      }
    }
    return strings;
  });
  const snapshot = await page.locator("body").ariaSnapshot();
  return [...fromDom, ...namesFromAriaSnapshot(snapshot)];
}

/** The strings on the current page that bypassed the catalog. Load the page with `?lang=pseudo` first. */
export async function findCatalogBypasses(
  page: Page,
  allowed: readonly AllowedText[] = [],
): Promise<string[]> {
  return findUnmarked(await collectReadableStrings(page), allowed);
}
