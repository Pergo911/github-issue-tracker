import { expect, test } from "./support/test.ts";
import { axeViolations } from "./support/axe.ts";
import { findCatalogBypasses } from "./support/pseudo-sweep.ts";

// The checks are only worth having if they can fail. These prove they do, on pages made for the purpose.
test.describe("the accessibility check", () => {
  test("fails a page with an image that has no text alternative", async ({ page }) => {
    await page.setContent(
      '<!doctype html><html lang="en"><head><title>x</title></head><body><main><img src="data:image/gif;base64,R0lGODlhAQABAAAAACw="></main></body></html>',
    );
    const violations = await axeViolations(page);
    expect(violations.join("\n")).toContain("image-alt");
  });

  test("passes a clean page", async ({ page }) => {
    await page.setContent(
      '<!doctype html><html lang="en"><head><title>x</title></head><body><main><h1>Title</h1></main></body></html>',
    );
    expect(await axeViolations(page)).toEqual([]);
  });
});

test.describe("the pseudo-language sweep", () => {
  const page = (body: string) =>
    `<!doctype html><html lang="en"><head><title>…</title></head><body>${body}</body></html>`;

  test("catches visible English, an aria-label, a screen-reader-only label and a title attribute", async ({
    page: browserPage,
  }) => {
    await browserPage.setContent(
      page(`
        <main>
          <p>«From the catalog»</p>
          <p>Stray visible English</p>
          <button aria-label="Close"><span aria-hidden="true">x</span></button>
          <button title="Dismiss">«ok»</button>
          <button><span style="position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)">Close dialog</span></button>
        </main>`),
    );
    const bypasses = await findCatalogBypasses(browserPage);
    expect(bypasses).toEqual(
      expect.arrayContaining(["Stray visible English", "Close", "Dismiss", "Close dialog"]),
    );
  });

  test("passes a page whose every string is marked, and ignores hidden text and declared data", async ({
    page: browserPage,
  }) => {
    await browserPage.setContent(
      page(`
        <main>
          <h1>«Heading»</h1>
          <button aria-label="«Close»">x</button>
          <p style="display:none">Hidden English the user never sees</p>
          <p>Rózsa Társasház</p>
        </main>`),
    );
    expect(await findCatalogBypasses(browserPage, ["Rózsa Társasház", "x"])).toEqual([]);
  });
});
