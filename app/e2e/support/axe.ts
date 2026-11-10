import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";
import { COLOR_SCHEMES } from "../screens.ts";

const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

/** The accessibility violations on the page as it is right now, as short readable lines. */
export async function axeViolations(page: Page): Promise<string[]> {
  const results = await new AxeBuilder({ page })
    .withTags(WCAG_TAGS)
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
  for (const scheme of COLOR_SCHEMES) {
    await page.emulateMedia({ colorScheme: scheme });
    // Switching the scheme retargets every `transition-colors` (see ui/button.tsx), so the page spends ~150ms
    // between the two palettes and axe would sample a colour that is in neither. Wait for them to settle (the
    // filter keeps a loading screen's spinner from holding the wait open), then a frame.
    await page.evaluate(() =>
      Promise.all(
        document
          .getAnimations()
          .filter((a) => a.effect?.getComputedTiming().iterations !== Infinity)
          .map((a) => a.finished.catch(() => null)),
      ),
    );
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => resolve(null))));
    expect(await axeViolations(page), `axe violations in ${scheme} mode`).toEqual([]);
  }
}
