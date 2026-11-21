import { expect, test } from "@playwright/test";
import { referenceScreens, visitScreenVariants } from "./screens.ts";

// `npm run test:visual`: every declared screen against its committed reference image, rendered in
// Playwright's Docker image (the same one CI uses), so a change you did not mean to make fails.
// The images live in e2e/reference/<screen>--<scheme>--<width>.png.
for (const screen of referenceScreens()) {
  test(screen.id, async ({ page, context }) => {
    await visitScreenVariants(page, context, screen, async (activePage, scheme, viewport) => {
      const name = `${screen.id}--${scheme}--${viewport.name}.png`;
      await expect.soft(activePage).toHaveScreenshot(name, { fullPage: true });
    });
  });
}
