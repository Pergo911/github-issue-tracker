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
    id: "submission-placeholder",
    description: "The Submission form's placeholder (ticket #23 replaces it).",
    server: "seeded",
    path: "/report",
    ready: headingShown,
    allowText: [referenceConfig.displayName],
    reference: false,
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
