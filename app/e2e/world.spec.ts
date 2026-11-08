import { remoteControl } from "../fakes/control.ts";
import { startBridge } from "../fakes/node/bridge.ts";
import { createTestWorld } from "../fakes/testing/world.ts";
import { controlUrl, urlFor } from "./support/servers.ts";
import { expect, test } from "./support/test.ts";

// The local world (ticket #22) in the real dev server: the Worker in workerd reaches the fake GitHub and the fake
// Resend over HTTP, the SPA's origin can call the fake GitHub cross-origin, and the control API drives it.
// These tests share the seeded server's world with the others: they add data and never reset it.

const githubBase = controlUrl("seeded").replace(/\/control$/, "/github");

test.describe("the local world in vite dev", () => {
  test("the Bot creates and reads an issue in the fake GitHub and a test email lands in the fake outbox", async ({
    request,
    world,
  }) => {
    const address = "local-world-demo@example.hu";
    const before = (await world.summary()).issues;
    const response = await request.post(urlFor("seeded", "/api/_dev/smoke"), {
      data: { to: address },
    });
    expect(response.status()).toBe(200);
    const result = await response.json();
    expect(result).toMatchObject({
      issueTitle: "Local world smoke test",
      author: "fault-reports-bot[bot]",
      authorType: "Bot",
    });
    expect((await world.summary()).issues).toBeGreaterThan(before);
    const mail = await world.latestMailTo(address);
    expect(mail?.id).toBe(result.mailId);
    expect(mail?.subject).toBe("Local world smoke test");
  });

  test("a Staff token resolves to its role through the Worker, and non-members and strangers are refused", async ({
    request,
    world,
  }) => {
    const whoami = (token?: string) =>
      request.get(urlFor("seeded", "/api/_dev/whoami"), {
        ...(token ? { headers: { authorization: `Bearer ${token}` } } : {}),
      });
    for (const [login, repoRole, role] of [
      ["e2e-viewer", "read", "viewer"],
      ["e2e-maintenance", "triage", "maintenance"],
      ["e2e-admin", "admin", "admin"],
    ] as const) {
      const { token } = await world.addStaff({ login, role: repoRole });
      const response = await whoami(token);
      expect(response.status()).toBe(200);
      expect(await response.json()).toEqual({ role, login });
    }
    const outsider = await world.addStaff({ login: "e2e-outsider", role: "none" });
    expect((await whoami(outsider.token)).status()).toBe(403);
    expect((await whoami()).status()).toBe(401);
    expect((await whoami("ghu_not_a_token")).status()).toBe(401);
  });

  test("the SPA's page can call the fake GitHub cross-origin, with the headers its githubFetch will send", async ({
    page,
    world,
  }) => {
    const { token } = await world.addStaff({ login: "e2e-browser-viewer", role: "read" });
    await page.goto(urlFor("seeded", "/"));
    const result = await page.evaluate(
      async ([base, bearer]) => {
        const response = await fetch(`${base}/repos/local-org/reports`, {
          headers: {
            authorization: `Bearer ${bearer}`,
            accept: "application/vnd.github+json",
            "x-github-api-version": "2022-11-28",
          },
        });
        const body = (await response.json()) as { permissions: { pull: boolean } };
        return { status: response.status, pull: body.permissions.pull };
      },
      [githubBase, token] as const,
    );
    expect(result).toEqual({ status: 200, pull: true });
  });

  test("the control API seeds Reports, and the fake GitHub's webhooks reach the Worker", async ({
    world,
  }) => {
    const { number } = await world.createReport({
      title: "e2e webhook probe",
      labels: ["e2e-probe"],
      webhooks: true,
    });
    await world.flushWebhooks();
    const deliveries = (await world.webhookDeliveries()).filter(
      (delivery) => delivery.issueNumber === number,
    );
    expect(deliveries.map((delivery) => delivery.action)).toEqual(["opened", "labeled"]);
    // The Worker answered (the webhook endpoint itself is ticket #26's, so the status is not asserted).
    for (const delivery of deliveries) expect(delivery.attempts[0]?.status).not.toBeNull();
  });

  test("the invariant check works through the control API, on a private world so no other test sees it", async ({
    request,
  }) => {
    // Violations are global to a server's world, and the lifecycle fixture drains them after every test: a test
    // that provokes one on a shared server would fail whichever test finishes next. So it gets a world of its own.
    const { world: privateWorld } = await createTestWorld();
    const bridge = await startBridge(privateWorld);
    try {
      const control = remoteControl(`${bridge.url}/control`);
      const address = "invariant-probe@example.hu";
      const { token } = await control.addStaff({ login: "probe-admin", role: "admin" });
      await control.protectEmail(address);
      const created = await request.post(`${bridge.url}/github/repos/fake-org/reports/issues`, {
        headers: {
          authorization: `Bearer ${token}`,
          "x-github-api-version": "2022-11-28",
          "user-agent": "e2e",
        },
        data: { title: "contact", body: address },
      });
      expect(created.status()).toBe(201);
      expect(await control.takeViolations()).toEqual([
        expect.objectContaining({ method: "POST", address, where: "body" }),
      ]);
    } finally {
      await bridge.close();
    }
  });
});
