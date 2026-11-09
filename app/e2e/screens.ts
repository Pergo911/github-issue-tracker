import { expect, type Page } from "@playwright/test";
import { referenceConfig } from "../src/shared/seed/reference-config.ts";
import type { AllowedText } from "./support/pseudo-sweep.ts";
import { urlFor, type ServerKind } from "./support/servers.ts";

/**
 * THE declared list of screens and states. Every ticket that adds or changes a screen adds or edits its
 * entries here, and that is what makes the screen part of the definition of done (AGENTS.md):
 *   - `npm run screenshots` captures each entry, light and dark, at 1280 and 375 px, in Hungarian, with your
 *     local browser, into .screenshots/ (git-ignored) with an index page. You open every image and check it.
 *   - `npm run test:visual` compares each entry with its committed reference image from Playwright's Docker
 *     image, so a change to a screen you did not mean to touch fails `verify`.
 *   - `npm run test:e2e` runs axe on each entry in both colour schemes, and the pseudo-language sweep that
 *     fails on any visible text or accessible name that did not come from the catalog.
 */
export interface Screen {
  /** Unique, kebab-case: used in file names, so renaming one renames its reference images. */
  id: string;
  description: string;
  /** Which local state the screen needs. `empty` is a fresh Deployment with no configuration. */
  server: ServerKind;
  path: string;
  /** Runs before navigation: hold, fail or fake a request to reach a state. */
  prepare?: (page: Page) => Promise<void>;
  /** Resolves once the screen is fully shown. Use roles, not text, so it works in every language. */
  ready: (page: Page) => Promise<void>;
  /** Visible text that is data rather than catalog wording (names, titles, dates): exempt from the sweep. */
  allowText?: AllowedText[];
  /** `false`: swept and checked for accessibility, but no reference images (a placeholder a later ticket replaces). */
  reference?: boolean;
}

export const COLOR_SCHEMES = ["light", "dark"] as const;
export type ColorScheme = (typeof COLOR_SCHEMES)[number];

export const VIEWPORTS = [
  { name: "1280", width: 1280, height: 800 },
  { name: "375", width: 375, height: 812 },
] as const;

const configUrl = "**/api/config/public";
const codeUrl = "**/api/reports/code";
const submitUrl = "**/api/reports/submit";

/** What a Reporter types: a Report's title and description are data too. */
const typed = {
  email: "anna.kiss@example.hu",
  title: "Elakadt a lift a lépcsőházban",
  description: "A lift megáll a lépcsőházban, és nem nyílik az ajtaja.",
  place: "B lépcsőház, hátsó lift",
};

/**
 * Text the Submission form shows that is data, not catalog wording: the Deployment's notices and taxonomy names,
 * and what was typed. Longest first, so a short name never cuts a longer text it is part of.
 */
const formData: AllowedText[] = [
  referenceConfig.displayName,
  referenceConfig.emergencyNotice,
  referenceConfig.codeSentHelp,
  typed.description,
  ...referenceConfig.taxonomy.category.map((value) => value.name),
  ...referenceConfig.taxonomy.location.map((value) => value.name),
].sort((a, b) => b.length - a.length);

async function fillForm(page: Page, overrides: Partial<typeof typed> = {}) {
  const values = { ...typed, ...overrides };
  await page.locator("#email").fill(values.email);
  await page.locator("#category").selectOption("elevator");
  await page.locator("#location").selectOption("stairwell");
  await page.locator("#title").fill(values.title);
  await page.locator("#description").fill(values.description);
  await page.locator("#place").fill(values.place);
}

const submitButton = (page: Page) => page.locator("form button[type=submit]");

/** The countdown reads the clock: freeze it, so the screenshot always says the full minute. */
const freezeClock = async (page: Page) => {
  await page.clock.setFixedTime(new Date("2026-03-02T09:00:00Z"));
};

/** The answers a screen fakes, so its state does not spend the Deployment's daily code budget or per-IP limit. */
const mockCodeSent = (page: Page) =>
  page.route(codeUrl, (route) => route.fulfill({ status: 200, json: { accepted: true } }));

const toCodeSent = async (page: Page) => {
  await fillForm(page);
  await submitButton(page).click();
  await expect(page.getByRole("heading", { level: 2 })).toBeVisible();
};

const headingShown = async (page: Page) => {
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
};

export const screens: Screen[] = [
  {
    id: "loading",
    description:
      "The neutral state while the public configuration loads (the request never answers).",
    server: "seeded",
    path: "/",
    prepare: async (page) => {
      await page.route(configUrl, () => {
        // Neither fulfilled nor continued: the request stays pending, so the loading state stays.
      });
    },
    ready: async (page) => {
      await expect(page.getByRole("status")).toBeVisible();
    },
  },
  {
    id: "not-configured",
    description: "A fresh Deployment with no config key: the English not-configured screen.",
    server: "empty",
    path: "/",
    ready: headingShown,
  },
  {
    id: "fetch-failed",
    description: "The configuration request fails: the English error screen with a retry button.",
    server: "seeded",
    path: "/",
    prepare: async (page) => {
      await page.route(configUrl, (route) => route.abort("connectionrefused"));
    },
    ready: async (page) => {
      await headingShown(page);
      await expect(page.getByRole("button")).toBeVisible();
    },
  },
  {
    id: "home",
    description:
      "The home page: the Organization's name in the header and the two entry points, in Hungarian.",
    server: "seeded",
    path: "/",
    ready: headingShown,
    allowText: [referenceConfig.displayName],
  },
  {
    id: "submission-empty",
    description:
      "The Submission form as a Reporter first sees it: the emergency notice and empty fields.",
    server: "seeded",
    path: "/report",
    ready: headingShown,
    allowText: formData,
  },
  {
    id: "submission-errors",
    description:
      "Send code pressed on an empty form: an inline error under each field and the summary.",
    server: "seeded",
    path: "/report",
    ready: async (page) => {
      await submitButton(page).click();
      await expect(page.locator("[aria-invalid=true]").first()).toBeFocused();
    },
    allowText: formData,
  },
  {
    id: "submission-title-rejected",
    description:
      "A title with a backtick: the catalog error naming the allowed characters; nothing is stripped.",
    server: "seeded",
    path: "/report",
    ready: async (page) => {
      await fillForm(page, { title: "Elakadt a `lift`" });
      await submitButton(page).click();
      await expect(page.locator("#title")).toHaveAttribute("aria-invalid", "true");
    },
    allowText: formData,
  },
  {
    id: "submission-filled",
    description: "Every field filled in, before a code is requested.",
    server: "seeded",
    path: "/report",
    ready: async (page) => {
      await fillForm(page);
      await expect(page.locator("#place")).toHaveValue(typed.place);
    },
    allowText: formData,
  },
  {
    id: "submission-code-sent",
    description:
      "Code requested: the generic notice, the configured help text and the resend countdown.",
    server: "seeded",
    path: "/report",
    prepare: async (page) => {
      await freezeClock(page);
      await mockCodeSent(page);
    },
    ready: toCodeSent,
    allowText: formData,
  },
  {
    id: "submission-code-wrong",
    description:
      "A wrong code entered and submitted: the code field's error, the form still editable.",
    server: "seeded",
    path: "/report",
    prepare: async (page) => {
      await freezeClock(page);
      await mockCodeSent(page);
      await page.route(submitUrl, (route) =>
        route.fulfill({ status: 422, json: { error: { code: "invalid_code" } } }),
      );
    },
    ready: async (page) => {
      await toCodeSent(page);
      await page.locator("#code").fill("123456");
      await submitButton(page).click();
      await expect(page.locator("#code")).toHaveAttribute("aria-invalid", "true");
    },
    allowText: formData,
  },
  {
    id: "submission-rate-limited",
    description: "The Deployment's code budget or the per-address limit is spent: the 429 message.",
    server: "seeded",
    path: "/report",
    prepare: async (page) => {
      await page.route(codeUrl, (route) =>
        route.fulfill({ status: 429, json: { error: { code: "rate_limited" } } }),
      );
    },
    ready: async (page) => {
      await fillForm(page);
      await submitButton(page).click();
      await expect(page.getByRole("alert")).toBeVisible();
    },
    allowText: formData,
  },
  {
    id: "submission-submitting",
    description: "The final submit in flight: the form is locked and the button says so.",
    server: "seeded",
    path: "/report",
    prepare: async (page) => {
      await freezeClock(page);
      await mockCodeSent(page);
      await page.route(submitUrl, () => {
        // Never answered: the form stays in its submitting state.
      });
    },
    ready: async (page) => {
      await toCodeSent(page);
      await page.locator("#code").fill("123456");
      await submitButton(page).click();
      await expect(page.locator("form[aria-busy=true]")).toBeVisible();
    },
    allowText: formData,
  },
  {
    id: "submission-confirmation",
    description:
      "The confirmation page: the Report number, its title and the permanent Status link.",
    server: "seeded",
    path: "/report",
    prepare: async (page) => {
      await freezeClock(page);
      await mockCodeSent(page);
      await page.route(submitUrl, (route) =>
        route.fulfill({
          status: 200,
          json: {
            number: 12,
            title: typed.title,
            statusUrl: "https://reports.example.hu/status/8s2Qn1vYt0xk7ZcLw3HfPA",
          },
        }),
      );
    },
    ready: async (page) => {
      await toCodeSent(page);
      await page.locator("#code").fill("123456");
      await submitButton(page).click();
      await expect(page.getByRole("link", { name: /status/ })).toBeVisible();
    },
    allowText: [
      ...formData,
      typed.title,
      "https://reports.example.hu/status/8s2Qn1vYt0xk7ZcLw3HfPA",
      "#12",
    ],
  },
  {
    id: "staff-placeholder",
    description: "The Staff sign-in's placeholder (ticket #27 replaces it).",
    server: "seeded",
    path: "/staff",
    ready: headingShown,
    allowText: [referenceConfig.displayName],
    reference: false,
  },
  {
    id: "not-found",
    description: "An address no route claims.",
    server: "seeded",
    path: "/no-such-page",
    ready: headingShown,
    allowText: [referenceConfig.displayName],
    reference: false,
  },
];

/** Opens a screen's state: prepares the request fakes, navigates and waits until it is shown. */
export async function openScreen(
  page: Page,
  screen: Screen,
  options: { pseudo?: boolean } = {},
): Promise<void> {
  await screen.prepare?.(page);
  const path = options.pseudo
    ? `${screen.path}${screen.path.includes("?") ? "&" : "?"}lang=pseudo`
    : screen.path;
  await page.goto(urlFor(screen.server, path));
  await screen.ready(page);
}

export const referenceScreens = () => screens.filter((screen) => screen.reference !== false);
