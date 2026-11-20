import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { test } from "@playwright/test";
import { COLOR_SCHEMES, openScreen, screens, VIEWPORTS } from "./screens.ts";

// `npm run screenshots`: every declared screen, light and dark, wide and narrow, in Hungarian, in your own
// browser (real fonts). The runner sets SCREENSHOT_DIR and builds the index page afterwards.
const directory = process.env["SCREENSHOT_DIR"];

for (const screen of screens) {
  for (const scheme of COLOR_SCHEMES) {
    for (const viewport of VIEWPORTS) {
      test.describe(`${screen.id} ${scheme} ${viewport.name}`, () => {
        test.use({
          colorScheme: scheme,
          viewport: { width: viewport.width, height: viewport.height },
        });
        test("is captured", async ({ page }) => {
          if (!directory) throw new Error("SCREENSHOT_DIR is not set; run `npm run screenshots`");
          await openScreen(page, screen);
          await page.mouse.move(-1, -1);
          mkdirSync(join(directory, screen.id), { recursive: true });
          await page.screenshot({
            path: join(directory, screen.id, `${scheme}-${viewport.name}.png`),
            fullPage: true,
            animations: "disabled",
            caret: "hide",
          });
        });
      });
    }
  }
}
