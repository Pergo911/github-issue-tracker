import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";
import { COLOR_SCHEMES } from "../screens.ts";

const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
/** Rules in WCAG_TAGS whose result can change when `prefers-color-scheme` flips (theme.css changes colours only). */
const COLOR_SCHEME_RULES = ["color-contrast", "link-in-text-block"];

/**
 * Waits for non-infinite CSS transitions/animations (such as `transition-colors` after a colour-scheme switch)
 * to settle, plus one animation frame. Infinite spinners are excluded so loading screens do not hang.
 */
export async function waitForVisualSettle(page: Page): Promise<void> {
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((animation) => animation.effect?.getComputedTiming().iterations !== Infinity)
        .map((animation) => animation.finished.catch(() => null)),
    ),
  );
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => resolve(null))));
}

/** The accessibility violations on the page as it is right now, as short readable lines. */
export async function axeViolations(
  page: Page,
  options: { rules?: string[] } = {},
): Promise<string[]> {
  const builder = new AxeBuilder({ page });
  if (options.rules) builder.withRules(options.rules);
  else builder.withTags(WCAG_TAGS);
  const results = await builder
    // Base UI's popups bracket themselves with aria-hidden, focusable guard spans on purpose (they trap and
    // return focus); axe reports them only while a popup is open, and only sometimes.
    .exclude("[data-base-ui-focus-guard]")
    .analyze();
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
  for (const [index, scheme] of COLOR_SCHEMES.entries()) {
    await page.emulateMedia({ colorScheme: scheme });
    // Switching the scheme retargets every `transition-colors` (see ui/button.tsx), so the page spends ~150ms
    // between the two palettes and axe would sample a colour that is in neither.
    await waitForVisualSettle(page);
    const violations =
      index === 0
        ? await axeViolations(page)
        : await axeViolations(page, { rules: COLOR_SCHEME_RULES });
    expect(violations, `axe violations in ${scheme} mode`).toEqual([]);
  }
}
