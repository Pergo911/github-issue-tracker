import { env, exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { TEST_BOT, TEST_ORG, TEST_REPO } from "@fakes/testing/constants.ts";
import { fakeWorld } from "../testing/world.ts";

// The Staff sign-in proxy (SPEC 2.2) and the role-gated metadata endpoint (SPEC 4.3, 2.4), through the real
// Worker against the fake GitHub: no client_secret anywhere, and the same answers to every Staff role.

const call = (path: string, init?: RequestInit) =>
  exports.default.fetch(`https://reports.test${path}`, init);
const post = (path: string, body: unknown) =>
  call(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

async function startFlow() {
  const response = await post("/api/staff/device-code", {});
  expect(response.status).toBe(200);
  return response.json<{
    deviceCode: string;
    userCode: string;
    verificationUri: string;
    expiresIn: number;
    interval: number;
  }>();
}

describe("POST /api/staff/device-code", () => {
  it("returns the code, the verification page, the lifetime and the interval GitHub gave", async () => {
    const flow = await startFlow();
    expect(flow.userCode).toMatch(/^[A-Z]{4}-[A-Z]{4}$/);
    expect(flow.verificationUri).toBe("https://github.com/login/device");
    expect(flow.expiresIn).toBe(900);
    expect(flow.interval).toBe(5);
    expect(flow.deviceCode.length).toBeGreaterThan(10);
  });
});

describe("POST /api/staff/device-token", () => {
  it("passes on pending, slow_down, expired and denied, and finally the tokens", async () => {
    const world = fakeWorld();
    world.control.addStaff({ login: "mate-maintenance", role: "triage" });
    world.control.configure({ strictPolling: false });
    const flow = await startFlow();
    const poll = async () =>
      (await post("/api/staff/device-token", { deviceCode: flow.deviceCode })).json<{
        status: string;
        [key: string]: unknown;
      }>();

    expect(await poll()).toEqual({ status: "pending" });
    world.control.scriptNextDevicePoll("slow_down");
    expect(await poll()).toEqual({ status: "slow_down", interval: expect.any(Number) });

    world.control.approveDeviceCode(flow.userCode, "mate-maintenance");
    const authorized = await poll();
    expect(authorized).toMatchObject({
      status: "authorized",
      expiresIn: 28_800,
      refreshTokenExpiresIn: expect.any(Number),
    });
    expect(authorized["accessToken"]).toMatch(/^ghu_/);
    expect(authorized["refreshToken"]).toMatch(/^ghr_/);

    const other = await startFlow();
    world.control.expireDeviceCode(other.userCode);
    expect(
      await (await post("/api/staff/device-token", { deviceCode: other.deviceCode })).json(),
    ).toEqual({ status: "expired" });

    const third = await startFlow();
    world.control.denyDeviceCode(third.userCode);
    expect(
      await (await post("/api/staff/device-token", { deviceCode: third.deviceCode })).json(),
    ).toEqual({ status: "denied" });
  });

  it("rejects a request without a device code", async () => {
    expect((await post("/api/staff/device-token", {})).status).toBe(400);
  });
});

describe("POST /api/staff/refresh", () => {
  it("exchanges a refresh token for a new pair, and says refresh_rejected for a bad one", async () => {
    const world = fakeWorld();
    world.control.addStaff({ login: "adam-admin", role: "admin" });
    world.control.configure({ strictPolling: false });
    const flow = await startFlow();
    world.control.approveDeviceCode(flow.userCode, "adam-admin");
    const first = await (
      await post("/api/staff/device-token", { deviceCode: flow.deviceCode })
    ).json<{ refreshToken: string; accessToken: string }>();

    const refreshed = await post("/api/staff/refresh", { refreshToken: first.refreshToken });
    expect(refreshed.status).toBe(200);
    const pair = await refreshed.json<{ accessToken: string; refreshToken: string }>();
    expect(pair.accessToken).not.toBe(first.accessToken);

    const reused = await post("/api/staff/refresh", { refreshToken: first.refreshToken });
    expect(reused.status).toBe(401);
    expect(await reused.json()).toEqual({ error: { code: "refresh_rejected" } });
  });
});

describe("GET /api/staff/meta", () => {
  it.each([
    ["read", "viewer"],
    ["triage", "maintenance"],
    ["admin", "admin"],
  ] as const)(
    "tells a %s member the %s role, the repo and the expected Bot identity",
    async (repoRole, role) => {
      const { token } = fakeWorld().control.addStaff({ login: `user-${repoRole}`, role: repoRole });
      const response = await call("/api/staff/meta", {
        headers: { authorization: `Bearer ${token}` },
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        role,
        login: `user-${repoRole}`,
        repo: { owner: TEST_ORG, name: TEST_REPO },
        bot: { login: `${TEST_BOT.slug}[bot]`, id: expect.any(Number), type: "Bot" },
      });
    },
  );

  it("refuses a non-member and a caller with no token, and never serves the identity unauthenticated", async () => {
    const outsider = fakeWorld().control.addStaff({ login: "nora-outsider", role: "none" });
    const denied = await call("/api/staff/meta", {
      headers: { authorization: `Bearer ${outsider.token}` },
    });
    expect(denied.status).toBe(403);
    expect((await call("/api/staff/meta")).status).toBe(401);
    expect(env.GITHUB_ORG).toBe(TEST_ORG);
  });
});
