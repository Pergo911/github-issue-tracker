import { afterEach, describe, expect, it } from "vitest";
import { remoteControl } from "../control.ts";
import { signTestJwt } from "../testing/jwt.ts";
import { createTestWorld } from "../testing/world.ts";
import { startBridge, type Bridge } from "./bridge.ts";

// The world over real HTTP on loopback: what the dev server's Worker, the browser and the `world` command use.

let bridge: Bridge | undefined;
afterEach(async () => {
  await bridge?.close();
  bridge = undefined;
});

async function serve() {
  const test = await createTestWorld();
  bridge = await startBridge(test.world);
  const headers = { "user-agent": "bridge-test", "x-github-api-version": "2022-11-28" };
  return { ...test, bridge, headers, url: bridge.url };
}

describe("the HTTP bridge", () => {
  it("serves the fake GitHub, with its JSON, status and headers, to a real fetch", async () => {
    const { url, headers, control } = await serve();
    const { token } = control.addStaff({ login: "adam-admin", role: "admin" });
    const response = await fetch(`${url}/github/repos/fake-org/reports`, {
      headers: { ...headers, authorization: `Bearer ${token}` },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(((await response.json()) as { permissions: { admin: boolean } }).permissions.admin).toBe(
      true,
    );
  });

  it("carries request bodies, so the Bot's whole flow works over the wire", async () => {
    const { url, headers, keys, bot } = await serve();
    const jwt = await signTestJwt(keys.privateKeyPkcs8, { iss: String(bot.appId) });
    const minted = await fetch(
      `${url}/github/app/installations/${bot.installationId}/access_tokens`,
      {
        method: "POST",
        headers: { ...headers, authorization: `Bearer ${jwt}` },
      },
    );
    const { token } = (await minted.json()) as { token: string };
    const created = await fetch(`${url}/github/repos/fake-org/reports/issues`, {
      method: "POST",
      headers: { ...headers, authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ title: "Over the wire", labels: ["a"] }),
    });
    expect(created.status).toBe(201);
    expect(((await created.json()) as { title: string }).title).toBe("Over the wire");
  });

  it("serves the fake Resend and its outbox", async () => {
    const { url, control } = await serve();
    const sent = await fetch(`${url}/resend/emails`, {
      method: "POST",
      headers: {
        "user-agent": "t",
        authorization: "Bearer re_x",
        "content-type": "application/json",
      },
      body: JSON.stringify({ from: "a@b.hu", to: "c@d.hu", subject: "s", text: "t" }),
    });
    expect(sent.status).toBe(200);
    expect(control.outbox()).toHaveLength(1);
  });

  it("exposes the control API to the remote client", async () => {
    const { url } = await serve();
    const remote = remoteControl(`${url}/control`);
    await remote.seed();
    expect((await remote.summary()).issues).toBeGreaterThan(0);
    expect(await remote.outbox()).toEqual([]);
  });

  it("drops the connection for a lost response, so the caller's fetch rejects", async () => {
    const { url, headers, control } = await serve();
    const { token } = control.addStaff({ login: "a", role: "admin" });
    control.addFault({
      service: "github",
      path: "/issues$",
      method: "POST",
      effect: { type: "lost-response" },
    });
    await expect(
      fetch(`${url}/github/repos/fake-org/reports/issues`, {
        method: "POST",
        headers: {
          ...headers,
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ title: "ghost" }),
      }),
    ).rejects.toThrow();
    expect(control.summary().issues).toBe(1);
  });

  it("holds a timeout fault until the caller gives up", async () => {
    const { url, headers, control } = await serve();
    const { token } = control.addStaff({ login: "a", role: "admin" });
    control.addFault({ service: "github", effect: { type: "timeout" } });
    const started = Date.now();
    await expect(
      fetch(`${url}/github/repos/fake-org/reports`, {
        headers: { ...headers, authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(100),
      }),
    ).rejects.toThrow();
    expect(Date.now() - started).toBeLessThan(5000);
  });

  it("answers 404 for an unknown path and releases its port on close", async () => {
    const { url, bridge: running } = await serve();
    expect((await fetch(`${url}/elsewhere`)).status).toBe(404);
    await running.close();
    bridge = undefined;
    await expect(fetch(`${url}/control/summary`)).rejects.toThrow();
  });
});
