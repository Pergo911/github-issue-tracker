import type { Page } from "@playwright/test";

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
