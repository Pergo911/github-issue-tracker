import { expect, test } from "./support/test.ts";
import { en } from "../src/shared/i18n/en.ts";
import { hu } from "../src/shared/i18n/hu.ts";
import { referenceConfig } from "../src/shared/seed/reference-config.ts";
import { screens, openScreen } from "./screens.ts";
import { expectAccessible } from "./support/axe.ts";
import { urlFor } from "./support/servers.ts";

const configUrl = "**/api/config/public";
const screen = (id: string) => {
  const found = screens.find((candidate) => candidate.id === id);
  if (!found) throw new Error(`no declared screen "${id}"`);
  return found;
};

test.describe("boot", () => {
  test("shows a neutral loading state while the configuration loads", async ({ page }) => {
    await openScreen(page, screen("loading"));
    await expect(page.getByRole("status")).toHaveText(en["boot.loading"]);
    // Neutral: no branding, no entry points, until the Deployment's configuration is known.
    await expect(page.getByRole("banner")).toHaveCount(0);
    await expect(page.getByRole("link")).toHaveCount(0);
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
  });

  test("shows the English not-configured screen on a Deployment with no config key", async ({
    page,
  }) => {
    await openScreen(page, screen("not-configured"));
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      en["boot.notConfigured.title"],
    );
    await expect(page.getByText(en["boot.notConfigured.description"])).toBeVisible();
    await expect(page.getByRole("banner")).toHaveCount(0);
    await expectAccessible(page);
  });

  test("shows the English error screen when the request fails, and recovers on retry", async ({
    page,
  }) => {
    let failing = true;
    await page.route(configUrl, (route) =>
      failing ? route.abort("connectionrefused") : route.continue(),
    );
    await page.goto(urlFor("seeded", "/"));
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(en["boot.fetchFailed.title"]);

    failing = false;
    await page.getByRole("button", { name: en["boot.retry"] }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(hu["home.heading"]);
  });

  test("treats a server error, not only a lost connection, as a failed load", async ({ page }) => {
    await page.route(configUrl, (route) =>
      route.fulfill({ status: 500, json: { error: { code: "internal_error" } } }),
    );
    await page.goto(urlFor("seeded", "/"));
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(en["boot.fetchFailed.title"]);
    await expect(page.getByRole("button", { name: en["boot.retry"] })).toBeVisible();
  });

  test("fetches the configuration once, before anything is rendered", async ({ page }) => {
    const requests: string[] = [];
    page.on("request", (request) => {
      if (request.url().includes("/api/config/public")) requests.push(request.url());
    });
    await page.goto(urlFor("seeded", "/"));
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    expect(requests).toHaveLength(1);
  });
});

test.describe("home page", () => {
  test("shows the Organization's name and the two entry points, in the configured language", async ({
    page,
  }) => {
    await openScreen(page, screen("home"));
    const header = page.getByRole("banner");
    await expect(header).toContainText(referenceConfig.displayName);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(hu["home.heading"]);

    const submission = page.getByRole("link", { name: hu["home.submission.title"] });
    const staff = page.getByRole("link", { name: hu["home.staff.title"] });
    await expect(submission).toHaveAttribute("href", "/report");
    await expect(staff).toHaveAttribute("href", "/staff");
    await expect(page.locator("html")).toHaveAttribute("lang", "hu");
    await expect(page).toHaveTitle(referenceConfig.displayName);
    await expectAccessible(page);
  });

  test("never mentions GitHub: that appears only on the staff sign-in", async ({ page }) => {
    await openScreen(page, screen("home"));
    await expect(page.locator("body")).not.toContainText(/github/i);
    await expect(page.locator("svg")).not.toHaveCount(0);
  });

  test("follows the OS colour scheme through Primer's tokens", async ({ page }) => {
    await openScreen(page, screen("home"));
    const background = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    await page.emulateMedia({ colorScheme: "light" });
    expect(await background()).toBe("rgb(255, 255, 255)");
    await page.emulateMedia({ colorScheme: "dark" });
    expect(await background()).toBe("rgb(13, 17, 23)");
  });

  test("leads to the form and the placeholder, and a reporter never downloads the staff chunk", async ({
    page,
  }) => {
    const modules: string[] = [];
    page.on("request", (request) => modules.push(request.url()));

    await openScreen(page, screen("home"));
    await page.getByRole("link", { name: hu["home.submission.title"] }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(hu["home.submission.title"]);
    await expect(page).toHaveURL(/\/report$/);
    expect(modules.some((url) => url.includes("/client/staff/"))).toBe(false);

    await page
      .getByRole("link", {
        name: hu["header.homeLink"].replace("{organization}", referenceConfig.displayName),
      })
      .click();
    await page.getByRole("link", { name: hu["home.staff.title"] }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(hu["home.staff.title"]);
    expect(modules.some((url) => url.includes("/client/staff/"))).toBe(true);
  });

  test("serves a deep link and an unknown address from the same single-page app", async ({
    page,
  }) => {
    await page.goto(urlFor("seeded", "/report"));
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(hu["home.submission.title"]);
    await page.goto(urlFor("seeded", "/staff/anything/at/all"));
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(hu["home.staff.title"]);
    await page.goto(urlFor("seeded", "/no-such-page"));
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(hu["notFound.title"]);
  });
});

test.describe("the Worker in front of the static assets", () => {
  test("answers /api/ itself, in JSON, and leaves every other path to the assets", async ({
    request,
  }) => {
    const config = await request.get(urlFor("seeded", "/api/config/public"));
    expect(config.status()).toBe(200);
    expect((await config.json()).displayName).toBe(referenceConfig.displayName);

    const unknown = await request.get(urlFor("seeded", "/api/nothing"));
    expect(unknown.status()).toBe(404);
    expect(await unknown.json()).toEqual({ error: { code: "not_found" } });

    const notConfigured = await request.get(urlFor("empty", "/api/config/public"));
    expect(notConfigured.status()).toBe(404);
    expect(await notConfigured.json()).toEqual({ error: { code: "not_configured" } });
  });
});
