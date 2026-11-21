import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { test } from "@playwright/test";
import { screens, visitScreenVariants } from "./screens.ts";

// `npm run screenshots`: every declared screen, light and dark, wide and narrow, in Hungarian, in your own
// browser (real fonts). The runner sets SCREENSHOT_DIR and builds the index page afterwards.
const directory = process.env["SCREENSHOT_DIR"];

for (const screen of screens) {
  test(screen.id, async ({ page, context }) => {
    if (!directory) throw new Error("SCREENSHOT_DIR is not set; run `npm run screenshots`");
    mkdirSync(join(directory, screen.id), { recursive: true });
    await visitScreenVariants(page, context, screen, async (activePage, scheme, viewport) => {
      await activePage.screenshot({
        path: join(directory, screen.id, `${scheme}-${viewport.name}.png`),
        fullPage: true,
        animations: "disabled",
        caret: "hide",
      });
    });
  });
}
