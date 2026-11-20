import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { codeFromMailbox } from "./support/mail.ts";
import { serverOrigin, urlFor } from "./support/servers.ts";
import { expect, test } from "./support/test.ts";
import type { AsyncControl } from "../fakes/control.ts";
import type { Page } from "@playwright/test";

// Recovery of interrupted and uncertain submissions against the real dev server and the local world (ticket #24,
// SPEC 4.1, ADR 0005): a response lost after the Report was created is resumed by the same tab, and an attempt
// that needs a person shows its reference until the operator CLI resolves it. Each test uses its own address and
// client address, as in submission.spec.ts; the create failure is armed per address (`/api/_dev/fail-create`)
// because a fake GitHub fault would be global to the tests running in parallel.

const run = promisify(execFile);
let counter = 0;

type Poster = { post: (url: string, options: { data: unknown }) => Promise<{ ok: () => boolean }> };

async function newReporter(page: Page, request: Poster, world: AsyncControl) {
  const unique = `${Date.now()}-${++counter}-${Math.floor(Math.random() * 1e6)}`;
  const email = `recover-${unique}@example.hu`;
  await world.protectEmail(email);
  const added = await request.post(urlFor("seeded", "/api/_dev/allowlist"), { data: { email } });
  expect(added.ok()).toBe(true);
  await page.setExtraHTTPHeaders({
    "x-dev-client-ip": `203.0.113.${(counter % 250) + 1}-${unique}`,
  });
  return { email, unique };
}

async function fillAndRequestCode(page: Page, world: AsyncControl, email: string) {
  await page.goto(urlFor("seeded", "/report"));
  await page.locator("#email").fill(email);
  await page.locator("#category").selectOption("elevator");
  await page.locator("#location").selectOption("stairwell");
  await page.locator("#title").fill("Elakadt a lift e2e");
  await page.locator("#description").fill("A lift megáll.");
  await page.locator("#place").fill("B lépcsőház");
  await page.locator("form button[type=submit]").click();
  await expect(page.locator("#code")).toBeVisible();
  await page.locator("#code").fill(await codeFromMailbox(world, email));
}

test.describe("recovering a submission", () => {
  test("a lost response is resumed: refreshing while Still saving ends on the confirmation page", async ({
    page,
    request,
    world,
  }) => {
    const { email } = await newReporter(page, request, world);
    await fillAndRequestCode(page, world, email);

    // The server files the Report, but the answer never reaches the tab; and the tab cannot ask yet.
    await page.route("**/api/reports/submit", async (route) => {
      await route.fetch();
      await route.abort("connectionreset");
    });
    let blocked = true;
    await page.route("**/api/reports/resume", (route) =>
      blocked ? route.abort("connectionrefused") : route.continue(),
    );
    await page.locator("form button[type=submit]").click();
    await expect(page.getByRole("status")).toBeVisible();
    await expect(page.locator("form")).toHaveCount(0);

    // The refresh keeps the attempt in sessionStorage and resumes it without a new code
    blocked = false;
    await page.reload();
    const link = page.getByRole("link", { name: /\/status\// });
    await expect(link).toBeVisible();
    expect(await link.getAttribute("href")).toMatch(/\/status\/[A-Za-z0-9_-]{22}$/);
    const number = Number(/#(\d+)/.exec(await page.locator("dd").first().innerText())?.[1]);
    expect(number).toBeGreaterThan(0);
    // Exactly one Report, with its mappings: the confirmation email went out once
    await expect.poll(async () => (await world.outbox(email)).length).toBe(2);
  });

  test("an unresolved attempt shows its reference, and the operator CLI resolves it", async ({
    page,
    request,
    world,
  }) => {
    const { email, unique } = await newReporter(page, request, world);
    const armed = await request.post(urlFor("seeded", "/api/_dev/fail-create"), {
      data: { email },
    });
    expect(armed.ok()).toBe(true);
    await fillAndRequestCode(page, world, email);
    await page.locator("form button[type=submit]").click();

    // Nothing carries the marker, so the attempt needs a person: the reference, no resubmit button
    const reference = page.getByText(/^[0-9A-F]{4}-[0-9A-F]{4}$/);
    await expect(reference).toBeVisible();
    await expect(page.getByRole("button")).toHaveCount(0);
    const ref = (await reference.innerText()).trim();

    const operator = await world.addStaff({ login: `operator-${unique}`, role: "admin" });
    const cli = async (...args: string[]) =>
      (
        await run(
          process.execPath,
          ["scripts/recovery.ts", ...args, "--url", serverOrigin("seeded")],
          { env: { ...process.env, GITHUB_TOKEN: operator.token } },
        )
      ).stdout;

    expect(await cli("list")).toContain(ref);
    const inspected = await cli("inspect", "--reference", ref);
    expect(inspected).toContain(email);
    expect(inspected).toContain("no issue carries the marker");

    // The operator verifies the Report on GitHub and associates it: the mappings are finalized
    const { number } = await world.createReport({ title: "Elakadt a lift e2e" });
    expect(await cli("associate", "--reference", ref, "--issue", String(number))).toContain(
      `Issue #${number} is linked and its mappings are written.`,
    );
    expect(await cli("list")).not.toContain(ref);

    // The Reporter's tab, asking again, now finds the Report complete
    await page.reload();
    await expect(page.getByRole("link", { name: /\/status\// })).toBeVisible();
    await expect(page.locator("dd").first()).toHaveText(`#${number}`);
  });

  test("the operator can discard an unresolved attempt", async ({ page, request, world }) => {
    const { email, unique } = await newReporter(page, request, world);
    await request.post(urlFor("seeded", "/api/_dev/fail-create"), { data: { email } });
    await fillAndRequestCode(page, world, email);
    await page.locator("form button[type=submit]").click();
    await expect(page.getByText(/^[0-9A-F]{4}-[0-9A-F]{4}$/)).toBeVisible();

    const operator = await world.addStaff({ login: `operator-${unique}`, role: "admin" });
    const { stdout } = await run(
      process.execPath,
      ["scripts/recovery.ts", "discard", "--email", email, "--url", serverOrigin("seeded")],
      { env: { ...process.env, GITHUB_TOKEN: operator.token } },
    );
    expect(stdout).toContain("discarded");
  });
});
