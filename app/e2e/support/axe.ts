import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";
import { COLOR_SCHEMES } from "../screens.ts";

const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

/** The accessibility violations on the page as it is right now, as short readable lines. */
export async function axeViolations(page: Page): Promise<string[]> {
  const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  return results.violations.map(
    (violation) =>
      `${violation.id} (${violation.impact ?? "n/a"}): ${violation.help}\n    ` +
      violation.nodes.map((node) => node.target.join(" ")).join("\n    "),
  );
}

/**
 * Fails on any axe violation, in light and in dark (contrast depends on the resolved Primer tokens).
 * Wait for the screen to be fully shown first: axe checks the page as it is at the call. Call it from a
 * journey test at every screen the journey reaches that is not already in the screens list.
 */
export async function expectAccessible(page: Page): Promise<void> {
  for (const scheme of COLOR_SCHEMES) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => resolve(null))));
    expect(await axeViolations(page), `axe violations in ${scheme} mode`).toEqual([]);
  }
}
