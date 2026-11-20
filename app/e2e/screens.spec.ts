import { expect, test } from "./support/test.ts";
import { openScreen, screens } from "./screens.ts";
import { expectAccessible } from "./support/axe.ts";
import { findCatalogBypasses } from "./support/pseudo-sweep.ts";

// Every declared screen: no axe violation in light or dark, and no text or accessible name that bypassed
// the catalog (the app is loaded in the test-only pseudo-language, which marks every catalog string).
for (const screen of screens) {
  test.describe(screen.id, () => {
    test("has no accessibility violations", async ({ page }) => {
      await openScreen(page, screen);
      await expectAccessible(page);
    });

    test("shows only text from the catalog", async ({ page }) => {
      await openScreen(page, screen, { pseudo: true });
      expect(await findCatalogBypasses(page, screen.allowText)).toEqual([]);
    });
  });
}
