import { controlUrl, urlFor } from "./support/servers.ts";
import { expect, test } from "./support/test.ts";
import type { AsyncControl } from "../fakes/control.ts";
import type { Page } from "@playwright/test";

// The Submission form against the real dev server and the local world (ticket #23, SPEC 4.1): the whole
// journey with the code read from the fake outbox, and the paths that must look the same or must refuse.
// Each test uses its own address and its own client address (`x-dev-client-ip`), because the per-IP limit and
// the cooldown of one address would otherwise couple tests that run in parallel.

const githubBase = controlUrl("seeded").replace(/\/control$/, "/github");
let counter = 0;

async function newReporter(
  page: Page,
  request: { post: (url: string, options: { data: unknown }) => Promise<{ ok: () => boolean }> },
  world: AsyncControl,
  options: { listed: boolean },
) {
  const unique = `${Date.now()}-${++counter}-${Math.floor(Math.random() * 1e6)}`;
  const email = `e2e-${unique}@example.hu`;
  await world.protectEmail(email);
  if (options.listed) {
    const response = await request.post(urlFor("seeded", "/api/_dev/allowlist"), {
      data: { email },
    });
    expect(response.ok()).toBe(true);
  }
  await page.setExtraHTTPHeaders({
    "x-dev-client-ip": `203.0.113.${(counter % 250) + 1}-${unique}`,
  });
  return email;
}

async function fill(page: Page, email: string, title = "Elakadt a lift e2e") {
  await page.goto(urlFor("seeded", "/report"));
  await page.locator("#email").fill(email);
  await page.locator("#category").selectOption("elevator");
  await page.locator("#location").selectOption("stairwell");
  await page.locator("#title").fill(title);
  await page.locator("#description").fill("A lift megáll.\n```\nnem kerítés");
  await page.locator("#place").fill("B lépcsőház");
}

async function codeFromOutbox(world: AsyncControl, email: string): Promise<string> {
  await expect
    .poll(async () => (await world.outbox(email)).length, { timeout: 15_000 })
    .toBeGreaterThan(0);
  const mails = await world.outbox(email);
  const code = /\b(\d{6})\b/.exec(mails.at(-1)?.text ?? "")?.[1];
  expect(code).toBeTruthy();
  return code as string;
}

test.describe("the Submission form", () => {
  test("a listed Reporter files a Report, and the Bot's issue and the confirmation email are right", async ({
    page,
    request,
    world,
  }) => {
    const email = await newReporter(page, request, world, { listed: true });
    await fill(page, email);
    await page.locator("form button[type=submit]").click();
    await expect(page.getByRole("heading", { level: 2 })).toBeVisible();
    await expect(page.locator("#code")).toBeVisible();
    // The credential is kept in sessionStorage before the final dispatch
    const code = await codeFromOutbox(world, email);
    await page.locator("#code").fill(code);
    await page.locator("form button[type=submit]").click();

    const link = page.getByRole("link", { name: /\/status\// });
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute("target", "_blank");
    const statusUrl = (await link.getAttribute("href")) as string;
    expect(statusUrl).toMatch(/\/status\/[A-Za-z0-9_-]{22}$/);
    const heading = page.getByRole("heading", { level: 1 });
    await expect(heading).toBeVisible();
    const number = Number(/#(\d+)/.exec(await page.locator("dd").first().innerText())?.[1]);
    expect(number).toBeGreaterThan(0);
    expect(
      await page.evaluate(() => sessionStorage.getItem("report-attempt-credential")),
    ).toBeNull();

    // The issue in the fake GitHub: labels, the title unchanged and an exactly canonical body
    const { token } = await world.addStaff({ login: `e2e-reader-${counter}`, role: "read" });
    const issue = await (
      await request.get(`${githubBase}/repos/local-org/reports/issues/${number}`, {
        headers: {
          authorization: `Bearer ${token}`,
          accept: "application/vnd.github+json",
          "x-github-api-version": "2022-11-28",
          "user-agent": "e2e",
        },
      })
    ).json();
    expect(issue.title).toBe("Elakadt a lift e2e");
    expect(issue.labels.map((label: { name: string }) => label.name).sort()).toEqual([
      "category:elevator",
      "location:stairwell",
      "status:new",
    ]);
    expect(issue.body).toMatch(
      /^\*\*Kategória:\*\* Lift\n\*\*Helyszín:\*\* Lépcsőház\n\n\*\*Pontos hely:\*\*\n```\nB lépcsőház\n```\n\n\*\*Leírás:\*\*\n````\nA lift megáll\.\n```\nnem kerítés\n````\n\n<!-- fault-report-attempt: [A-Za-z0-9_-]{22} -->$/,
    );
    expect(issue.body).not.toContain(email);
    expect(issue.body).not.toContain(statusUrl.split("/").at(-1));

    const confirmation = (await world.outbox(email)).find((mail) =>
      mail.subject.startsWith(`Bejelentés #${number}`),
    );
    expect(confirmation?.text).toContain(statusUrl);
  });

  test("an unlisted address gets the same code-sent screen and no mail", async ({
    page,
    request,
    world,
  }) => {
    const email = await newReporter(page, request, world, { listed: false });
    await fill(page, email);
    await page.locator("form button[type=submit]").click();
    await expect(page.getByRole("heading", { level: 2 })).toBeVisible();
    await expect(page.locator("#code")).toBeVisible();
    await page.waitForTimeout(1_000);
    expect(await world.outbox(email)).toEqual([]);
  });

  test("five wrong codes burn the code, even the right one afterwards", async ({
    page,
    request,
    world,
  }) => {
    const email = await newReporter(page, request, world, { listed: true });
    await fill(page, email);
    await page.locator("form button[type=submit]").click();
    const code = await codeFromOutbox(world, email);
    const wrong = code === "000000" ? "000001" : "000000";
    for (let guess = 0; guess < 5; guess++) {
      await page.locator("#code").fill(wrong);
      await page.locator("form button[type=submit]").click();
      await expect(page.locator("#code")).toHaveAttribute("aria-invalid", "true");
    }
    await page.locator("#code").fill(code);
    await page.locator("form button[type=submit]").click();
    await expect(page.locator("#code")).toHaveAttribute("aria-invalid", "true");
    await expect(page.getByRole("link", { name: /\/status\// })).toHaveCount(0);
  });

  test("an exhausted budget shows the rate-limited message, and the form stays usable", async ({
    page,
  }) => {
    await page.route("**/api/reports/code", (route) =>
      route.fulfill({ status: 429, json: { error: { code: "rate_limited" } } }),
    );
    await fill(page, "someone@example.hu");
    await page.locator("form button[type=submit]").click();
    await expect(page.getByRole("alert")).toBeVisible();
    await expect(page.locator("#code")).toHaveCount(0);
    await expect(page.locator("#email")).toBeEditable();
  });

  test("a rejected title character is refused with an error and nothing is sent", async ({
    page,
  }) => {
    let sent = false;
    await page.route("**/api/reports/**", (route) => {
      sent = true;
      return route.abort();
    });
    await fill(page, "someone@example.hu", "Elakadt a `lift`");
    await page.locator("form button[type=submit]").click();
    await expect(page.locator("#title")).toHaveAttribute("aria-invalid", "true");
    await expect(page.locator("#title")).toHaveValue("Elakadt a `lift`");
    expect(sent).toBe(false);
  });
});
