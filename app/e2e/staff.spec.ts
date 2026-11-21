import type { Page } from "@playwright/test";
import { hu } from "../src/shared/i18n/hu.ts";
import { expectAccessible } from "./support/axe.ts";
import { urlFor } from "./support/servers.ts";
import { staffToken, startSignedIn } from "./support/staff.ts";
import { expect, test } from "./support/test.ts";
import { SLOW_SIGN_IN } from "./support/timings.ts";

// The Staff dashboard's sign-in and List view (ticket #27), end to end: the real Worker, the real device-flow proxy
// and role check, and the fake GitHub. The tests share the seeded server's world, so each names its own data
// with a unique tag and looks only at rows that carry it.

const CODE = /^[A-Z]{4}-[A-Z]{4}$/;
const tag = (name: string) =>
  `${name}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

const rows = (page: Page) => page.locator("[data-report]");
const rowOf = (page: Page, text: string) => rows(page).filter({ hasText: text });
const link = (page: Page, name: string) => page.getByRole("link", { name, exact: true });

/** Runs the device flow to the end as `login`, approving it through the fake. */
async function signInThroughDeviceFlow(
  page: Page,
  world: { approveDeviceCode: (code: string, login: string) => Promise<void> },
  login: string,
) {
  await page.goto(urlFor("seeded", "/staff"));
  await page.getByRole("button", { name: hu["staff.signIn.start"] }).click();
  const code = (await page.getByText(CODE).textContent()) ?? "";
  await world.approveDeviceCode(code, login);
}

const storedTokens = (page: Page) =>
  page.evaluate(
    () =>
      JSON.parse(localStorage.getItem("staff.tokens") ?? "null") as {
        accessToken: string;
        refreshToken: string;
        accessExpiresAt: number;
      } | null,
  );

test.describe("signing in with the device flow", () => {
  for (const role of ["viewer", "maintenance", "admin"] as const) {
    test(`a ${role} signs in, lands on the Reports with their role, and sees only their navigation`, async ({
      page,
      world,
    }) => {
      const { login } = await staffToken(`e2e-flow-${role}`, role);
      await page.goto(urlFor("seeded", "/staff"));
      await page.getByRole("button", { name: hu["staff.signIn.start"] }).click();

      // The code, and a link to GitHub's verification page that opens in a new tab.
      const code = (await page.getByText(CODE).textContent()) ?? "";
      const open = link(page, hu["staff.device.open"]);
      await expect(open).toHaveAttribute("target", "_blank");
      await expect(open).toHaveAttribute("href", "https://github.com/login/device");
      await expectAccessible(page);

      await world.approveDeviceCode(code, login);
      await expect(page.getByRole("heading", { level: 1, name: hu["reports.title"] })).toBeVisible(
        SLOW_SIGN_IN,
      );
      await expect(page).toHaveURL(/\/staff\/reports/);
      await expect(page.getByText(login)).toBeVisible();
      await expect(
        page.getByText(hu[`staff.role.${role}`], { exact: false }).first(),
      ).toBeVisible();
      await expect(link(page, hu["staff.nav.reports"])).toBeVisible();
      const adminLinks = [
        hu["staff.nav.allowlist"],
        hu["staff.nav.members"],
        hu["staff.nav.configuration"],
      ];
      for (const name of adminLinks) {
        await expect(link(page, name)).toHaveCount(role === "admin" ? 1 : 0);
      }
    });
  }

  test("a GitHub account that is not a member gets the no-access screen, and can sign out", async ({
    page,
    world,
  }) => {
    const { login } = await staffToken("e2e-flow-outsider", "none");
    await signInThroughDeviceFlow(page, world, login);
    await expect(
      page.getByRole("heading", { level: 1, name: hu["staff.noAccess.title"] }),
    ).toBeVisible(SLOW_SIGN_IN);
    await expect(rows(page)).toHaveCount(0);
    await page.getByRole("button", { name: hu["staff.signOut"] }).click();
    await expect(page.getByRole("button", { name: hu["staff.signIn.start"] })).toBeVisible();
    expect(await storedTokens(page)).toBeNull();
  });

  test("an expired code is shown as expired and a restart gives a new code", async ({
    page,
    world,
  }) => {
    await page.goto(urlFor("seeded", "/staff"));
    await page.getByRole("button", { name: hu["staff.signIn.start"] }).click();
    const first = (await page.getByText(CODE).textContent()) ?? "";
    await world.expireDeviceCode(first);
    await expect(
      page.getByRole("heading", { level: 1, name: hu["staff.device.expired.title"] }),
    ).toBeVisible(SLOW_SIGN_IN);
    await page.getByRole("button", { name: hu["staff.device.restart"] }).click();
    await expect(page.getByText(CODE)).toBeVisible();
    expect(await page.getByText(CODE).textContent()).not.toBe(first);
  });

  test("a refused sign-in is reported and can be restarted", async ({ page, world }) => {
    await page.goto(urlFor("seeded", "/staff"));
    await page.getByRole("button", { name: hu["staff.signIn.start"] }).click();
    await world.denyDeviceCode((await page.getByText(CODE).textContent()) ?? "");
    await expect(
      page.getByRole("heading", { level: 1, name: hu["staff.device.denied.title"] }),
    ).toBeVisible(SLOW_SIGN_IN);
    await expect(page.getByRole("button", { name: hu["staff.device.restart"] })).toBeVisible();
  });
});

test.describe("the session", () => {
  test("a 401 refreshes the token silently and retries once; so does an access token that is past its time on load", async ({
    page,
    world,
  }) => {
    const { login } = await staffToken("e2e-refresh", "maintenance");
    await signInThroughDeviceFlow(page, world, login);
    await expect(page.getByRole("heading", { level: 1, name: hu["reports.title"] })).toBeVisible(
      SLOW_SIGN_IN,
    );
    const first = await storedTokens(page);
    expect(first?.refreshToken).toMatch(/^ghr_/);

    // GitHub says the access token has expired, once: the SPA refreshes it and asks again with the new one.
    const authorizations: string[] = [];
    let refused = false;
    await page.route(/\/repos\/[^/]+\/[^/]+\/issues\?/, async (route) => {
      const request = route.request();
      if (request.method() === "OPTIONS") return route.fallback();
      authorizations.push(request.headers()["authorization"] ?? "");
      if (refused) return route.fallback();
      refused = true;
      return route.fulfill({
        status: 401,
        headers: { "access-control-allow-origin": "*" },
        json: { message: "Bad credentials" },
      });
    });
    await page.getByRole("button", { name: hu["reports.refresh"] }).click();
    // (More than two calls when the Reports take several pages: each page is fetched with the new token.)
    await expect.poll(() => authorizations.length).toBeGreaterThanOrEqual(2);
    const renewed = `Bearer ${(await storedTokens(page))?.accessToken}`;
    expect(authorizations[1]).not.toBe(authorizations[0]);
    expect(authorizations.slice(1).every((value) => value === renewed)).toBe(true);
    const second = await storedTokens(page);
    expect(second?.refreshToken).not.toBe(first?.refreshToken);
    await expect(page.getByRole("button", { name: hu["reports.refresh"] })).toBeEnabled();
    await expect(page.getByRole("alert")).toHaveCount(0);

    // An access token past its time is refreshed before the first call on load.
    await page.evaluate(() => {
      const tokens = JSON.parse(localStorage.getItem("staff.tokens") ?? "{}") as object;
      localStorage.setItem("staff.tokens", JSON.stringify({ ...tokens, accessExpiresAt: 0 }));
    });
    await page.reload();
    await expect(page.getByRole("heading", { level: 1, name: hu["reports.title"] })).toBeVisible();
    await expect
      .poll(async () => (await storedTokens(page))?.refreshToken)
      .not.toBe(second?.refreshToken);
  });

  test("a refresh token the server refuses signs the member out and starts a fresh device flow", async ({
    page,
  }) => {
    const { token } = await staffToken("e2e-refresh-refused", "viewer");
    // A token GitHub no longer accepts, with a refresh token it has never issued.
    await page.addInitScript(() => {
      localStorage.setItem(
        "staff.tokens",
        JSON.stringify({
          accessToken: "ghu_expired",
          refreshToken: "ghr_never_issued",
          accessExpiresAt: Date.now() + 3_600_000,
          refreshExpiresAt: Date.now() + 3_600_000,
        }),
      );
    });
    void token;
    await page.goto(urlFor("seeded", "/staff"));
    await expect(page.getByRole("button", { name: hu["staff.signIn.start"] })).toBeVisible();
    expect(await storedTokens(page)).toBeNull();
  });

  test("signing out clears the tokens, and points at GitHub's Applications settings", async ({
    page,
  }) => {
    const { token } = await staffToken("e2e-signout", "viewer");
    await startSignedIn(page, token);
    await page.goto(urlFor("seeded", "/staff"));
    await expect(page.getByRole("heading", { level: 1, name: hu["reports.title"] })).toBeVisible();
    await page.getByRole("button", { name: hu["staff.signOut"] }).click();

    await expect(page.getByText(hu["staff.signedOut.notice"])).toBeVisible();
    const revoke = link(page, hu["staff.signedOut.revokeLink"]);
    await expect(revoke).toHaveAttribute("href", "https://github.com/settings/applications");
    await expect(revoke).toHaveAttribute("target", "_blank");
    expect(await storedTokens(page)).toBeNull();
    await expectAccessible(page);

    await page.reload();
    await expect(page.getByRole("button", { name: hu["staff.signIn.start"] })).toBeVisible();
  });

  test("a reporter's routes never load the staff chunk; the staff routes do", async ({ page }) => {
    const requested: string[] = [];
    page.on("request", (request) => requested.push(new URL(request.url()).pathname));
    for (const path of ["/", "/report"]) {
      await page.goto(urlFor("seeded", path));
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    }
    expect(requested.filter((path) => path.includes("/client/staff/"))).toEqual([]);
    await page.goto(urlFor("seeded", "/staff"));
    await expect(page.getByRole("button", { name: hu["staff.signIn.start"] })).toBeVisible();
    expect(requested.some((path) => path.includes("/client/staff/"))).toBe(true);
  });
});

test.describe("the role gates the navigation", () => {
  for (const [role, admin] of [
    ["viewer", false],
    ["maintenance", false],
    ["admin", true],
  ] as const) {
    test(`as a ${role}: Admin links ${admin ? "shown" : "hidden"}, and an Admin address is ${admin ? "open" : "sent back to the Reports"}`, async ({
      page,
    }) => {
      const { token } = await staffToken(`e2e-nav-${role}`, role);
      await startSignedIn(page, token);
      await page.goto(urlFor("seeded", "/staff/allowlist"));
      if (admin) {
        await expect(
          page.getByRole("heading", { level: 1, name: hu["staff.nav.allowlist"] }),
        ).toBeVisible();
        await expect(link(page, hu["staff.nav.members"])).toBeVisible();
        await expect(link(page, hu["staff.nav.configuration"])).toBeVisible();
      } else {
        await expect(page).toHaveURL(/\/staff\/reports/);
        await expect(link(page, hu["staff.nav.allowlist"])).toHaveCount(0);
        await expect(link(page, hu["staff.nav.members"])).toHaveCount(0);
        await expect(link(page, hu["staff.nav.configuration"])).toHaveCount(0);
      }
    });
  }
});

test.describe("the List view", () => {
  test("is sorted by Priority (most urgent first, untriaged last), then oldest first", async ({
    page,
    world,
  }) => {
    const id = tag("sort");
    for (const [name, labels] of [
      ["low", ["priority:low"]],
      ["none-old", []],
      ["urgent-old", ["priority:urgent"]],
      ["high", ["priority:high"]],
      ["urgent-new", ["priority:urgent"]],
    ] as const) {
      await world.createReport({
        title: `${id} ${name}`,
        labels: [...labels, "category:plumbing", "location:floor-1", "status:new"],
      });
    }
    const { token } = await staffToken("e2e-sort", "maintenance");
    await startSignedIn(page, token);
    await page.goto(urlFor("seeded", "/staff/reports"));
    await expect(rowOf(page, id)).toHaveCount(5);
    const titles = await rowOf(page, id).locator("[data-report-title]").allInnerTexts();
    const order = titles.map((title) => title.slice(id.length + 1));
    expect(order).toEqual(["urgent-old", "urgent-new", "high", "low", "none-old"]);
  });

  test("filters client-side with chips, keeps them in the URL, and survives a reload", async ({
    page,
    world,
  }) => {
    const id = tag("filter");
    // The assignee must exist before a Report can be assigned to them.
    const { token } = await staffToken("e2e-filter-user", "maintenance");
    await world.createReport({
      title: `${id} water`,
      labels: ["category:plumbing", "location:floor-2", "priority:high", "status:new"],
      assignees: ["e2e-filter-user"],
    });
    await world.createReport({
      title: `${id} lift`,
      labels: ["category:elevator", "location:elevator", "status:on-hold"],
    });
    await world.createReport({
      title: `${id} closed`,
      labels: ["category:plumbing", "location:floor-1"],
      state: "closed",
      stateReason: "completed",
    });
    await startSignedIn(page, token);
    await page.goto(urlFor("seeded", "/staff/reports"));
    await expect(rowOf(page, id)).toHaveCount(2);

    const select = (label: string) => page.getByRole("combobox", { name: label });
    let requests = 0;
    page.on("request", (request) => {
      if (/\/repos\/.+\/issues\?/.test(request.url()) && request.method() === "GET") requests += 1;
    });

    await select(hu["reports.filter.category"]).selectOption("plumbing");
    await expect(page).toHaveURL(/category=plumbing/);
    await expect(rowOf(page, id)).toHaveCount(1);
    await expect(rowOf(page, `${id} water`)).toBeVisible();
    // Filtering is client-side: no new request for the Reports.
    expect(requests).toBe(0);

    await select(hu["reports.filter.assignee"]).selectOption("e2e-filter-user");
    await expect(page).toHaveURL(/assignee=e2e-filter-user/);
    await page.reload();
    await expect(select(hu["reports.filter.category"])).toHaveValue("plumbing");
    await expect(select(hu["reports.filter.assignee"])).toHaveValue("e2e-filter-user");
    await expect(rowOf(page, `${id} water`)).toBeVisible();

    await page.getByRole("button", { name: hu["reports.filter.clear"] }).click();
    await expect(page).not.toHaveURL(/category=/);
    await expect(rowOf(page, id)).toHaveCount(2);

    await page.getByRole("button", { name: hu["reports.filter.untriaged"] }).click();
    await expect(page).toHaveURL(/untriaged=1/);
    await expect(rowOf(page, `${id} lift`)).toBeVisible();
    await expect(rowOf(page, `${id} water`)).toHaveCount(0);

    await page.getByRole("button", { name: hu["reports.filter.clear"] }).click();
    await page.getByRole("button", { name: hu["reports.state.closed"] }).click();
    await expect(page).toHaveURL(/state=closed/);
    await expect(rowOf(page, `${id} closed`)).toBeVisible();
    await expect(rowOf(page, `${id} water`)).toHaveCount(0);
  });

  test("shows the empty state for filters that match nothing", async ({ page }) => {
    const { token } = await staffToken("e2e-empty", "viewer");
    await startSignedIn(page, token);
    await page.goto(
      urlFor(
        "seeded",
        "/staff/reports?category=elevator&priority=low&status=on-hold&location=roof&assignee=nobody-at-all",
      ),
    );
    await expect(
      page.getByRole("heading", { level: 2, name: hu["reports.empty.filtered.title"] }),
    ).toBeVisible();
    await expectAccessible(page);
  });

  test("searches the whole history through GitHub's search, closed Reports included, and clears it", async ({
    page,
    world,
  }) => {
    const id = tag("zebra");
    await world.createReport({ title: `${id} open one`, labels: ["category:other", "status:new"] });
    await world.createReport({
      title: `${id} closed one`,
      labels: ["category:other"],
      state: "closed",
      stateReason: "not_planned",
    });
    await world.createReport({ title: `${id} not a report`, pullRequest: true });
    await world.createReport({ title: `unrelated ${id.slice(0, 4)}`, labels: ["status:new"] });
    const { token } = await staffToken("e2e-search", "viewer");
    await startSignedIn(page, token);
    await page.goto(urlFor("seeded", "/staff/reports"));

    await page.getByRole("searchbox", { name: hu["reports.search.label"] }).fill(id);
    await page.getByRole("button", { name: hu["reports.search.submit"] }).click();
    await expect(page).toHaveURL(new RegExp(`q=${id}`));
    await expect(rowOf(page, `${id} open one`)).toBeVisible();
    await expect(rowOf(page, `${id} closed one`)).toBeVisible();
    await expect(rowOf(page, "not a report")).toHaveCount(0);
    await expect(rowOf(page, "unrelated")).toHaveCount(0);

    await page.getByRole("button", { name: hu["reports.search.clear"] }).click();
    await expect(page).not.toHaveURL(/q=/);
    await expect(rowOf(page, `unrelated ${id.slice(0, 4)}`)).toBeVisible();
  });

  test("never drops a Report: an invalid Status warns on its row, an unknown label shows its raw name", async ({
    page,
    world,
  }) => {
    const id = tag("invalid");
    await world.createReport({ title: `${id} none`, labels: ["category:other"] });
    await world.createReport({
      title: `${id} several`,
      labels: ["status:new", "status:on-hold", "category:other"],
    });
    await world.createReport({ title: `${id} obsolete`, labels: ["status:retired"] });
    await world.createReport({
      title: `${id} unknown`,
      labels: ["category:old-paint", "location:attic-v2", "status:new"],
    });
    await world.createReport({
      title: `${id} fine`,
      labels: ["category:other", "status:new", "unrelated-label"],
    });
    const { token } = await staffToken("e2e-invalid", "maintenance");
    await startSignedIn(page, token);
    await page.goto(urlFor("seeded", "/staff/reports"));
    await expect(rowOf(page, id)).toHaveCount(5);
    await expect(rowOf(page, `${id} none`)).toContainText(hu["reports.statusProblem.none"]);
    await expect(rowOf(page, `${id} several`)).toContainText(hu["reports.statusProblem.multiple"]);
    await expect(rowOf(page, `${id} obsolete`)).toContainText(hu["reports.statusProblem.obsolete"]);
    await expect(rowOf(page, `${id} unknown`)).toContainText("category:old-paint");
    await expect(rowOf(page, `${id} unknown`)).toContainText("location:attic-v2");
    await expect(rowOf(page, `${id} unknown`)).not.toContainText(/Status needs|javítani/);
    await expect(rowOf(page, `${id} fine`)).not.toContainText(hu["reports.statusProblem.none"]);
    await expect(rowOf(page, `${id} fine`)).not.toContainText("unrelated-label");
  });

  test("loads every page of Reports", async ({ page, world }) => {
    const id = tag("pages");
    const total = 105;
    for (let start = 0; start < total; start += 15) {
      await Promise.all(
        Array.from({ length: Math.min(15, total - start) }, (_, offset) =>
          world.createReport({
            title: `${id} number ${start + offset}`,
            labels: ["category:other", "status:new"],
          }),
        ),
      );
    }
    const { token } = await staffToken("e2e-pages", "viewer");
    await startSignedIn(page, token);
    const secondPage = page.waitForRequest(/\/repos\/.+\/issues\?.*page=2/);
    await page.goto(urlFor("seeded", "/staff/reports"));
    await secondPage;
    await expect(rowOf(page, id)).toHaveCount(total);
  });

  test("refreshes on demand and again when the member comes back to the List", async ({
    page,
    world,
  }) => {
    const id = tag("refresh");
    const { token } = await staffToken("e2e-refresh-list", "viewer");
    await startSignedIn(page, token);
    await page.goto(urlFor("seeded", "/staff/reports"));
    await expect(rows(page).first()).toBeVisible();
    await world.createReport({ title: `${id} appeared`, labels: ["category:other", "status:new"] });
    await expect(rowOf(page, id)).toHaveCount(0);
    await page.getByRole("button", { name: hu["reports.refresh"] }).click();
    await expect(rowOf(page, id)).toHaveCount(1);

    await world.createReport({ title: `${id} later`, labels: ["category:other", "status:new"] });
    // Leave the List and come back by navigating inside the app (no reload).
    await page.getByRole("link", { name: /kezdőlap/ }).click();
    await page.getByRole("link", { name: new RegExp(hu["home.staff.title"]) }).click();
    await expect(rowOf(page, id)).toHaveCount(2);
  });

  test("shows an error with a retry when the Reports cannot be loaded", async ({ page }) => {
    const { token } = await staffToken("e2e-error", "viewer");
    await startSignedIn(page, token);
    let failing = true;
    await page.route(/\/repos\/[^/]+\/[^/]+\/issues\?/, (route) =>
      failing ? route.abort("connectionrefused") : route.fallback(),
    );
    await page.goto(urlFor("seeded", "/staff/reports"));
    await expect(
      page.getByRole("heading", { level: 2, name: hu["reports.error.title"] }),
    ).toBeVisible();
    failing = false;
    await page.getByRole("button", { name: hu["boot.retry"] }).click();
    await expect(rows(page).first()).toBeVisible();
  });
});
