import { expect, test } from "@playwright/test";
import { COLOR_SCHEMES, openScreen, referenceScreens, VIEWPORTS } from "./screens.ts";

// `npm run test:visual`: every declared screen against its committed reference image, rendered in
// Playwright's Docker image (the same one CI uses), so a change you did not mean to make fails.
// The images live in e2e/reference/<screen>--<scheme>--<width>.png.
for (const screen of referenceScreens()) {
  for (const scheme of COLOR_SCHEMES) {
    for (const viewport of VIEWPORTS) {
      const name = `${screen.id}--${scheme}--${viewport.name}`;
      test.describe(name, () => {
        test.use({
          colorScheme: scheme,
          viewport: { width: viewport.width, height: viewport.height },
        });
        test("matches its reference image", async ({ page }) => {
          await openScreen(page, screen);
          await page.mouse.move(-1, -1);
          await expect(page).toHaveScreenshot(`${name}.png`, { fullPage: true });
        });
      });
    }
  }
}
