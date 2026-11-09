import { expect, type Page } from "@playwright/test";
import { starterConfig } from "../src/shared/config/defaults.ts";
import { referenceConfig } from "../src/shared/seed/reference-config.ts";
import type { Screen } from "./screens.ts";
import { staffData } from "./staff-screens.ts";
import { worldOf } from "./support/test.ts";
import type { AllowedText } from "./support/pseudo-sweep.ts";
import { staffToken, startSignedIn } from "./support/staff.ts";

// The Allowlist and Configuration screens of ticket #30, declared for screenshots, reference images, axe and the
// pseudo-language sweep (see the note at the top of screens.ts). The Allowlist's data is faked with `page.route`
// so every run looks the same and the shared seeded server's list is not touched; the Configuration screens read the
// seeded server's real configuration (nothing here saves a valid one). Sign-in, the role gate and the validation
// answer come from the real Worker.

const SLOW = { timeout: 30_000 };

/** Every string of the reference configuration that is wording the Organization wrote, not the catalog's. */
function textOf(config: unknown): AllowedText[] {
  const found: string[] = [];
  const walk = (value: unknown, key = "") => {
    if (typeof value === "string") {
      if (!["id", "color", "language", "timezone", "senderLocalPart"].includes(key))
        found.push(value);
    } else if (Array.isArray(value)) value.forEach((item) => walk(item));
    else if (value && typeof value === "object") {
      for (const [name, item] of Object.entries(value)) walk(item, name);
    }
  };
  walk(config);
  // The identifiers shown as hints and the template placeholders are data too.
  return [...new Set(found)].sort((a, b) => b.length - a.length);
}

const configData: AllowedText[] = [
  ...textOf(referenceConfig),
  ...staffData,
  // The sender's address part and the IANA example in a hint are not wording either.
  "reports",
  "Europe/Budapest",
  /\{\w+\}/,
];

// The notes first and longest first: a note may contain a taxonomy name ("1. emelet"), which would otherwise be
// cut out of it and leave the rest behind.
const allowlistData: AllowedText[] = [
  "Szabó Gábor, 1. emelet",
  "Nagy Béla, garázs",
  "Kiss Anna, 2/5",
  "Kovács Éva",
  "Elköltözött",
  "this is not an address",
  "not an address",
  ...staffData,
  /[\w.+-]+@example\.hu/,
  /\d{4}\. \p{L}+\. \d+\./u,
  "ada-admin",
  "kata-admin",
];

const entries = [
  {
    email: "anna.kiss@example.hu",
    note: "Kiss Anna, 2/5",
    addedBy: "ada-admin",
    addedAt: "2026-05-04T08:00:00.000Z",
  },
  {
    email: "bela.nagy@example.hu",
    note: "Nagy Béla, garázs",
    addedBy: "ada-admin",
    addedAt: "2026-05-04T08:00:00.000Z",
  },
  { email: "eva.kovacs@example.hu", addedBy: "kata-admin", addedAt: "2026-04-18T12:30:00.000Z" },
  {
    email: "gabor.szabo@example.hu",
    note: "Szabó Gábor, 1. emelet",
    addedBy: "kata-admin",
    addedAt: "2026-03-02T09:15:00.000Z",
  },
];

const listUrl = "**/api/staff/allowlist";
const bulkUrl = "**/api/staff/allowlist/bulk";

async function signedInAdmin(page: Page) {
  const { token } = await staffToken("screen-admin", "admin");
  await startSignedIn(page, token);
}

/** Answers the Allowlist's GET with fixed entries; every other method goes to the real Worker. */
function serveList(list: typeof entries) {
  return async (page: Page) => {
    await signedInAdmin(page);
    await page.route(listUrl, (route) =>
      route.request().method() === "GET"
        ? route.fulfill({ json: { entries: list } })
        : route.continue(),
    );
  };
}

const entriesShown = async (page: Page) => {
  await expect(page.locator("[data-allowlist-entry]").first()).toBeVisible(SLOW);
};

const configShown = async (page: Page) => {
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible(SLOW);
  await expect(page.locator("form input").first()).toBeVisible(SLOW);
};

const saveButton = (page: Page) => page.locator("form button[type=submit]");

export const adminScreens: Screen[] = [
  {
    id: "allowlist-empty",
    description: "The Allowlist with no address on it: add forms and the empty state.",
    server: "seeded",
    path: "/staff/allowlist",
    prepare: serveList([]),
    ready: async (page) => {
      await expect(page.getByRole("heading", { level: 2 }).last()).toBeVisible(SLOW);
      await expect(page.locator("[data-allowlist-entry]")).toHaveCount(0);
    },
    allowText: allowlistData,
  },
  {
    id: "allowlist-populated",
    description:
      "The Allowlist with entries: address, note, who added it and when, and the actions.",
    server: "seeded",
    path: "/staff/allowlist",
    prepare: serveList(entries),
    ready: entriesShown,
    allowText: allowlistData,
  },
  {
    id: "allowlist-search",
    description: "A search that narrows the list by note.",
    server: "seeded",
    path: "/staff/allowlist",
    prepare: serveList(entries),
    ready: async (page) => {
      await entriesShown(page);
      await page.getByRole("searchbox").fill("garázs");
      await expect(page.locator("[data-allowlist-entry]")).toHaveCount(1);
    },
    allowText: [...allowlistData, "garázs"],
  },
  {
    id: "allowlist-bulk-result",
    description:
      "A pasted list with a bad line, a repeated address and one already on the list: the per-line report.",
    server: "seeded",
    path: "/staff/allowlist",
    prepare: async (page) => {
      await serveList(entries)(page);
      await page.route(bulkUrl, (route) =>
        route.fulfill({
          json: {
            added: entries.slice(0, 2),
            errors: [
              { line: 3, text: "this is not an address", code: "invalid_email" },
              { line: 4, text: "anna.kiss@example.hu", code: "already_listed" },
              { line: 5, text: "bela.nagy@example.hu Elköltözött", code: "duplicate" },
              {
                line: 6,
                text: `eva.kovacs@example.hu ${"x".repeat(210)}`,
                code: "note_too_long",
              },
            ],
          },
        }),
      );
    },
    ready: async (page) => {
      await entriesShown(page);
      await page.locator("textarea").fill("anna.kiss@example.hu\nbela.nagy@example.hu");
      await page.locator("form").nth(1).getByRole("button").click();
      // Not hovering the pressed button: Primer's dark hover colour is not what axe should judge here.
      await page.mouse.move(-1, -1);
      await expect(page.locator("[data-bulk-errors] li")).toHaveCount(4);
    },
    allowText: [...allowlistData, /x{20,}/],
  },
  {
    id: "allowlist-remove-confirm",
    description: "Removal asks first: what stays as it is, and the two buttons.",
    server: "seeded",
    path: "/staff/allowlist",
    prepare: serveList(entries),
    ready: async (page) => {
      await entriesShown(page);
      await page.locator('[data-allowlist-entry="bela.nagy@example.hu"] button').nth(1).click();
      await expect(page.getByRole("alert")).toBeVisible();
    },
    allowText: allowlistData,
  },
  {
    id: "allowlist-edit-note",
    description: "A note being edited in place.",
    server: "seeded",
    path: "/staff/allowlist",
    prepare: serveList(entries),
    ready: async (page) => {
      await entriesShown(page);
      await page.locator('[data-allowlist-entry="anna.kiss@example.hu"] button').first().click();
      await expect(
        page.locator('[data-allowlist-entry="anna.kiss@example.hu"] input'),
      ).toBeVisible();
    },
    allowText: allowlistData,
  },
  {
    id: "allowlist-error",
    description: "The list could not be loaded: an error with a retry.",
    server: "seeded",
    path: "/staff/allowlist",
    prepare: async (page) => {
      await signedInAdmin(page);
      await page.route(listUrl, (route) => route.abort("connectionrefused"));
    },
    ready: async (page) => {
      await expect(page.getByRole("heading", { level: 2 }).last()).toBeVisible(SLOW);
      await expect(page.getByRole("button", { name: /./ }).last()).toBeVisible();
    },
    allowText: staffData,
  },
  {
    id: "config-organization",
    description:
      "The Configuration screen, Organization section: name, emergency notice, help text.",
    server: "seeded",
    path: "/staff/configuration",
    prepare: signedInAdmin,
    ready: configShown,
    allowText: configData,
  },
  {
    id: "config-taxonomy",
    description:
      "The Taxonomy editor: every dimension's values with name, identifier (fixed), colour and its live label pill, order and Status flags.",
    server: "seeded",
    path: "/staff/configuration?section=taxonomy",
    prepare: signedInAdmin,
    ready: async (page) => {
      await expect(page.locator("[data-taxonomy-value]").first()).toBeVisible(SLOW);
      await expect(page.locator("[data-label-pill]").first()).toBeVisible();
    },
    allowText: configData,
  },
  {
    id: "config-taxonomy-remove-warning",
    description:
      "Removing a saved value warns that Reports still wearing it show the raw identifier.",
    server: "seeded",
    path: "/staff/configuration?section=taxonomy",
    prepare: signedInAdmin,
    ready: async (page) => {
      const value = page.locator('[data-taxonomy-value="category:other"]');
      await expect(value).toBeVisible(SLOW);
      await value.getByRole("button").nth(2).click();
      await expect(page.getByRole("alert")).toBeVisible();
    },
    allowText: configData,
  },
  {
    id: "config-email",
    description: "The Email sender section: sender part, name, reply-to, reply clause and footer.",
    server: "seeded",
    path: "/staff/configuration?section=email",
    prepare: signedInAdmin,
    ready: configShown,
    allowText: configData,
  },
  {
    id: "config-templates",
    description: "The six email templates, each listing its placeholders.",
    server: "seeded",
    path: "/staff/configuration?section=templates",
    prepare: signedInAdmin,
    ready: configShown,
    allowText: configData,
  },
  {
    id: "config-system",
    description: "Language, time zone and the daily code budget.",
    server: "seeded",
    path: "/staff/configuration?section=system",
    prepare: signedInAdmin,
    ready: configShown,
    allowText: configData,
  },
  {
    id: "config-validation-errors",
    description:
      "A refused save: the summary, the problem count on the section, and each field's error in place.",
    server: "seeded",
    path: "/staff/configuration?section=taxonomy",
    prepare: signedInAdmin,
    ready: async (page) => {
      // By structure, not by name: the sweep runs the screen in the pseudo-language.
      const priority = page.locator('section[aria-labelledby="dimension-priority"]');
      await expect(priority.getByRole("listitem").first()).toBeVisible(SLOW);
      const second = priority.getByRole("listitem").nth(1);
      // Inputs of a value: display name, identifier (fixed once saved), colour. An empty name and a bad colour.
      await second.locator("input").nth(0).fill("");
      await second.locator("input").nth(2).fill("zzz");
      await saveButton(page).click();
      await expect(page.getByRole("alert")).toBeVisible();
      await expect(second).toContainText(/./);
    },
    // With the name emptied the pill falls back to the identifier, which is data.
    allowText: [...configData, "zzz", "normal"],
  },
  {
    id: "config-fresh",
    description:
      "A fresh Deployment: a System admin lands on the Configuration screen, pre-filled with the starter configuration, in English.",
    server: "empty",
    path: "/staff",
    prepare: async (page) => {
      const { token } = await worldOf("empty").addStaff({ login: "screen-admin", role: "admin" });
      await startSignedIn(page, token);
    },
    ready: async (page) => {
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible(SLOW);
      await expect(page.locator("#displayName")).toBeVisible(SLOW);
    },
    allowText: [...textOf(starterConfig), ...staffData],
  },
  {
    id: "staff-not-configured",
    description: "A fresh Deployment seen by a member who is not a System admin: not configured.",
    server: "empty",
    path: "/staff",
    prepare: async (page) => {
      const { token } = await worldOf("empty").addStaff({
        login: "screen-maintenance",
        role: "triage",
      });
      await startSignedIn(page, token);
    },
    ready: async (page) => {
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible(SLOW);
      await expect(page.getByRole("button")).toBeVisible();
    },
    allowText: staffData,
  },
];
