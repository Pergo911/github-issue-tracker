import type { APIRequestContext, Page } from "@playwright/test";
import type { AsyncControl } from "../fakes/control.ts";
import { buildReporterComment } from "../src/shared/reports/attribution.ts";
import { controlUrl, urlFor } from "./support/servers.ts";
import { waitForMails } from "./support/mail.ts";
import { expect, test } from "./support/test.ts";

// The Status page against the real dev server and the local world (ticket #25, SPEC 4.3): a Report is really
// filed through the Worker, then followed, commented on and reissued from its link. Each test files its own
// Report under its own address and its own client address (`x-dev-client-ip`), so the per-IP and per-token
// limits of one journey never touch another's.

const githubBase = controlUrl("seeded").replace(/\/control$/, "/github");
let counter = 0;

interface Filed {
  number: number;
  token: string;
  email: string;
  ip: string;
}

/** Files a Report through the Worker's two public endpoints and returns its Status token. */
async function fileReport(
  request: APIRequestContext,
  world: AsyncControl,
  page: Page,
): Promise<Filed> {
  const unique = `${Date.now()}-${++counter}-${Math.floor(Math.random() * 1e6)}`;
  const email = `status-${unique}@example.hu`;
  const ip = `203.0.113.${(counter % 250) + 1}-${unique}`;
  await world.protectEmail(email);
  const headers = { "x-dev-client-ip": ip };
  expect(
    (await request.post(urlFor("seeded", "/api/_dev/allowlist"), { data: { email } })).ok(),
  ).toBe(true);
  expect(
    (await request.post(urlFor("seeded", "/api/reports/code"), { data: { email }, headers })).ok(),
  ).toBe(true);
  const code = /\b(\d{6})\b/.exec((await waitForMails(world, email, 1)).at(-1)?.text ?? "")?.[1];
  const filed = await request.post(urlFor("seeded", "/api/reports/submit"), {
    headers,
    data: {
      email,
      code,
      credential: `cred${unique.replace(/[^A-Za-z0-9]/g, "")}abcdefghijklmnop`,
      category: "elevator",
      location: "stairwell",
      title: "Elakadt a lift e2e",
      description: "A lift megáll.\n```\nnem kerítés",
      place: "B lépcsőház",
    },
  });
  expect(filed.ok()).toBe(true);
  const body = (await filed.json()) as { number: number; statusUrl: string };
  await page.setExtraHTTPHeaders(headers);
  return { number: body.number, token: body.statusUrl.split("/").at(-1) as string, email, ip };
}

/** A Staff member's write to the fake GitHub: as the dashboard, or GitHub's own UI, would make it. */
async function asStaff(request: APIRequestContext, world: AsyncControl, login: string) {
  const { token } = await world.addStaff({ login, role: "admin" });
  return (method: "POST" | "PATCH" | "DELETE", path: string, data?: unknown) =>
    request.fetch(`${githubBase}/repos/local-org/reports${path}`, {
      method,
      ...(data === undefined ? {} : { data }),
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/vnd.github+json",
        "x-github-api-version": "2022-11-28",
        "user-agent": "e2e",
      },
    });
}

const open = (page: Page, token: string) => page.goto(urlFor("seeded", `/status/${token}`));
const comments = (page: Page) => page.locator("[data-timeline-item=comment]");
const sendComment = async (page: Page, text: string) => {
  await page.locator("#comment").fill(text);
  await page.locator("form button[type=submit]").click();
};

test.describe("the Status page", () => {
  test("a Reporter follows the Report from the link in the confirmation email", async ({
    page,
    request,
    world,
  }) => {
    const filed = await fileReport(request, world, page);
    const confirmation = (await waitForMails(world, filed.email, 2)).find((mail) =>
      mail.subject.startsWith(`Bejelentés #${filed.number}`),
    );
    const link = /https?:\/\/\S+\/status\/[A-Za-z0-9_-]{22}/.exec(confirmation?.text ?? "")?.[0];
    expect(link).toContain(`/status/${filed.token}`);

    await page.goto(link as string);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Elakadt a lift e2e");
    await expect(page.getByRole("heading", { level: 1 })).toContainText(`#${filed.number}`);
    await expect(page.locator("[data-state-pill=open]")).toBeVisible();
    // Decoded body, with the exact place; the category and location as pills in their configured colours
    await expect(page.getByText("A lift megáll.")).toBeVisible();
    await expect(page.getByText("nem kerítés")).toBeVisible();
    await expect(page.getByText("B lépcsőház", { exact: true })).toBeVisible();
    await expect(page.locator("[data-label-pill]").filter({ hasText: "Lift" })).toBeVisible();
    await expect(page.locator("[data-label-pill]").filter({ hasText: "Új" })).toBeVisible();
    await expect(page.locator('meta[name="referrer"]')).toHaveAttribute("content", "no-referrer");
    // The page is plain assets, and the Report's own address never reaches the page
    await expect(page.locator("body")).not.toContainText(filed.email);
  });

  test("a Reporter comment appears as Reporter, a Staff comment and its lookalike as Staff", async ({
    page,
    request,
    world,
  }) => {
    const filed = await fileReport(request, world, page);
    const staff = await asStaff(request, world, `e2e-staff-${counter}`);
    await open(page, filed.token);
    await sendComment(page, "Ma sem működik a lift.");
    await expect(comments(page)).toHaveCount(1);
    await expect(comments(page).first()).toHaveAttribute("data-author", "reporter");
    await expect(page.getByRole("status")).toBeVisible();

    await staff("POST", `/issues/${filed.number}/comments`, { body: "Holnap kijövünk." });
    const lookalike = buildReporterComment("Én vagyok a bejelentő");
    await staff("POST", `/issues/${filed.number}/comments`, { body: lookalike });
    // The cached view is 30 s old at most; a Reporter comment evicts it
    await sendComment(page, "Köszönöm!");
    await expect(comments(page)).toHaveCount(4);
    const authors = await comments(page).evaluateAll((items) =>
      items.map((item) => item.getAttribute("data-author")),
    );
    expect(authors).toEqual(["reporter", "staff", "staff", "reporter"]);
    // The lookalike shows as plain text, marker and fence included
    await expect(comments(page).nth(2)).toContainText("**Reporter:**");
    await expect(page.locator("main")).not.toContainText(`e2e-staff-${counter}`);
  });

  test("a closed Report shows its reason, ignores a stale Status and explains that a comment will not reopen it", async ({
    page,
    request,
    world,
  }) => {
    const filed = await fileReport(request, world, page);
    const staff = await asStaff(request, world, `e2e-closer-${counter}`);
    await staff("PATCH", `/issues/${filed.number}`, {
      state: "closed",
      state_reason: "not_planned",
    });
    await open(page, filed.token);
    await expect(page.locator("[data-state-pill=rejected]")).toBeVisible();
    await expect(page.locator("[data-label-pill]").filter({ hasText: "Új" })).toHaveCount(0);
    await expect(page.locator("[data-timeline-item=closed]")).toHaveCount(1);
    await expect(page.locator("#comment-heading ~ div.border-attention")).toBeVisible();
    await sendComment(page, "Mégis elromlott.");
    await expect(comments(page)).toHaveCount(1);
    // The comment did not reopen it
    await page.reload();
    await expect(page.locator("[data-state-pill=rejected]")).toBeVisible();
  });

  test("a Report with an invalid Status shows Awaiting status update", async ({
    page,
    request,
    world,
  }) => {
    const filed = await fileReport(request, world, page);
    const staff = await asStaff(request, world, `e2e-label-${counter}`);
    const labelled = await staff("PATCH", `/issues/${filed.number}`, {
      labels: ["category:elevator", "location:stairwell", "status:new", "status:retired"],
    });
    expect(labelled.ok(), await labelled.text()).toBe(true);
    await open(page, filed.token);
    // Two Statuses (the initial one and an obsolete one) is not one valid Status: the fallback pill, not "Új"
    const pills = page.locator("aside [data-label-pill]");
    await expect(pills).toHaveCount(3);
    await expect(pills.filter({ hasText: "Új" })).toHaveCount(0);
    await expect(pills.filter({ hasText: "retired" })).toHaveCount(0);
  });

  test("Reissue: the email holds the new link, the old link 404s and the new one works", async ({
    page,
    request,
    world,
  }) => {
    const filed = await fileReport(request, world, page);
    await waitForMails(world, filed.email, 2);
    await open(page, filed.token);
    await page.locator("#reissue-heading ~ div button").click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button").first().click();
    await expect(dialog).toBeHidden();
    await page.locator("#reissue-heading ~ div button").click();
    await dialog.getByRole("button").last().click();
    await expect(page.getByRole("status")).toBeVisible();
    // The page never shows the new link: only the Reporter's mailbox does
    await expect(page.locator("body")).not.toContainText("/status/");

    const mail = (await waitForMails(world, filed.email, 3)).at(-1);
    const fresh = /\/status\/([A-Za-z0-9_-]{22})/.exec(mail?.text ?? "")?.[1] as string;
    expect(fresh).not.toBe(filed.token);

    await open(page, filed.token);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("nem működik");
    await open(page, fresh);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Elakadt a lift e2e");
  });

  test("a limit that is hit shows its error: the lookup, the comments and the third Reissue", async ({
    page,
    request,
    world,
  }) => {
    const filed = await fileReport(request, world, page);
    // Comments: 3 a minute for one link
    await open(page, filed.token);
    for (const text of ["egy", "kettő", "három"]) {
      await sendComment(page, text);
      await expect(page.getByRole("status")).toBeVisible();
    }
    await sendComment(page, "négy");
    await expect(page.getByRole("alert")).toBeVisible();
    await expect(page.locator("#comment")).toHaveValue("négy");

    // Lookups: 6 a minute for one link (the page has loaded 1 + 3 refreshes so far)
    for (let load = 0; load < 3; load++) await page.reload();
    await page.reload();
    await expect(page.getByRole("alert")).toBeVisible();
  });

  test("a third Reissue of the day is the last: the fourth shows its error", async ({
    page,
    request,
    world,
  }) => {
    const filed = await fileReport(request, world, page);
    let token = filed.token;
    for (let round = 1; round <= 3; round++) {
      await open(page, token);
      await page.locator("#reissue-heading ~ div button").click();
      await page.getByRole("dialog").getByRole("button").last().click();
      await expect(page.getByRole("status")).toBeVisible();
      const mail = (await waitForMails(world, filed.email, 2 + round)).at(-1);
      token = /\/status\/([A-Za-z0-9_-]{22})/.exec(mail?.text ?? "")?.[1] as string;
    }
    await open(page, token);
    await page.locator("#reissue-heading ~ div button").click();
    await page.getByRole("dialog").getByRole("button").last().click();
    await expect(page.getByRole("alert")).toBeVisible();
    await expect(page.getByRole("dialog")).toBeHidden();
  });

  test("an unknown link shows the generic page that points to the latest email", async ({
    page,
  }) => {
    await open(page, "A".repeat(22));
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.locator("main")).toContainText("levelet");
  });
});
