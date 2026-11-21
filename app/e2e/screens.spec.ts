import { expect, test } from "./support/test.ts";
import { openScreen, screens } from "./screens.ts";
import { expectAccessible } from "./support/axe.ts";
import { findCatalogBypasses } from "./support/pseudo-sweep.ts";

// Every declared screen: no text or accessible name that bypassed the catalog (loaded in the test-only
// pseudo-language, which only wraps catalog strings in marks without changing DOM structure or colours), and
// no axe violation in light or dark. Opening each screen once runs both checks in half the browser work.
for (const screen of screens) {
  test(screen.id, async ({ page }) => {
    await openScreen(page, screen, { pseudo: true });
    expect(
      await findCatalogBypasses(page, screen.allowText),
      "text or accessible name bypassed the catalog",
    ).toEqual([]);
    await expectAccessible(page);
  });
}
