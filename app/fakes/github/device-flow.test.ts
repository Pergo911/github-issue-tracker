import { describe, expect, it } from "vitest";
import { DEVICE_CODE_GRANT } from "@shared/github/constants.ts";
import { createTestWorld, TEST_STAFF_CLIENT_ID } from "../testing/world.ts";

// Device flow as GitHub's web endpoints behave (SPEC 2.2, docs "Authorizing OAuth apps"): errors are HTTP 200
// bodies, JSON only when asked for, refresh tokens are single use, and every outcome can be scripted.

async function start() {
  const test = await createTestWorld();
  test.control.configure({ strictPolling: false });
  test.control.addStaff({ login: "mate-maintenance", role: "triage" });
  const code = await test.client.web("POST", "/login/device/code", {
    form: { client_id: TEST_STAFF_CLIENT_ID },
  });
  const poll = (deviceCode: string = code.json.device_code) =>
    test.client.web("POST", "/login/oauth/access_token", {
      form: {
        client_id: TEST_STAFF_CLIENT_ID,
        device_code: deviceCode,
        grant_type: DEVICE_CODE_GRANT,
      },
    });
  return { ...test, code: code.json, poll };
}

describe("requesting a code", () => {
  it("answers the documented shape", async () => {
    const { code } = await start();
    expect(code).toMatchObject({
      verification_uri: "https://github.com/login/device",
      expires_in: 900,
      interval: 5,
    });
    expect(code.device_code).toMatch(/^[0-9a-f]{40}$/);
    expect(code.user_code).toMatch(/^[A-Z]{4}-[A-Z]{4}$/);
  });

  it("answers form-encoded unless the caller asks for JSON, as GitHub does", async () => {
    const { client } = await start();
    const reply = await client.web("POST", "/login/device/code", {
      form: { client_id: TEST_STAFF_CLIENT_ID },
      headers: { accept: "*/*" },
    });
    expect(reply.headers.get("content-type")).toContain("application/x-www-form-urlencoded");
    expect(new URLSearchParams(reply.text).get("device_code")).toMatch(/^[0-9a-f]{40}$/);
  });

  it("accepts a JSON request body too", async () => {
    const { client } = await start();
    const reply = await client.web("POST", "/login/device/code", {
      json: { client_id: TEST_STAFF_CLIENT_ID },
    });
    expect(reply.json.user_code).toBeTruthy();
  });

  it("refuses another client id, with an error inside a 200 as GitHub does", async () => {
    const { client } = await start();
    const reply = await client.web("POST", "/login/device/code", {
      form: { client_id: "someone-else" },
    });
    expect(reply.status).toBe(200);
    expect(reply.json.error).toBe("incorrect_client_credentials");
  });
});

describe("polling", () => {
  it("is pending until approved, then returns the 8-hour token and its refresh token, once", async () => {
    const { control, code, poll, client, org, repo } = await start();
    const pending = await poll();
    expect(pending.status).toBe(200);
    expect(pending.json.error).toBe("authorization_pending");

    control.approveDeviceCode(code.user_code, "mate-maintenance");
    const approved = await poll();
    expect(approved.json).toMatchObject({ token_type: "bearer", scope: "", expires_in: 28800 });
    expect(approved.json.access_token).toMatch(/^ghu_/);
    expect(approved.json.refresh_token).toMatch(/^ghr_/);
    expect(approved.json.refresh_token_expires_in).toBe(15897600);

    // The token is that user's, with the role of that user.
    const repoReply = await client.github("GET", `/repos/${org}/${repo}`, {
      token: approved.json.access_token,
    });
    expect(repoReply.json.permissions).toMatchObject({ triage: true, push: false, admin: false });

    // A used code is not valid again.
    expect((await poll()).json.error).toBe("incorrect_device_code");
  });

  it("answers an unknown device code and a wrong grant type with their errors", async () => {
    const { client, poll } = await start();
    expect((await poll("0".repeat(40))).json.error).toBe("incorrect_device_code");
    const wrong = await client.web("POST", "/login/oauth/access_token", {
      form: { client_id: TEST_STAFF_CLIENT_ID, device_code: "x", grant_type: "password" },
    });
    expect(wrong.json.error).toBe("unsupported_grant_type");
  });

  it("answers slow_down, with the new interval, when polled faster than the interval", async () => {
    const { control, code, poll } = await start();
    control.configure({ strictPolling: true });
    expect((await poll()).json.error).toBe("authorization_pending");
    const tooFast = await poll();
    expect(tooFast.json).toMatchObject({ error: "slow_down", interval: 10 });
    // Waiting out the (longer) interval is fine.
    control.advanceClock(10_000);
    expect((await poll()).json.error).toBe("authorization_pending");
    control.approveDeviceCode(code.user_code, "mate-maintenance");
    control.advanceClock(10_000);
    expect((await poll()).json.access_token).toBeTruthy();
  });

  it("answers expired_token after 900 seconds of the fake clock, or when a test expires the code", async () => {
    const first = await start();
    first.control.advanceClock(901_000);
    expect((await first.poll()).json.error).toBe("expired_token");

    const second = await start();
    second.control.expireDeviceCode(second.code.user_code);
    expect((await second.poll()).json.error).toBe("expired_token");
  });

  it("answers access_denied when the user denies the code", async () => {
    const { control, code, poll } = await start();
    control.denyDeviceCode(code.user_code);
    expect((await poll()).json.error).toBe("access_denied");
  });

  it("lets a test script the next poll's outcome, once, whatever the code's state", async () => {
    const { control, code, poll } = await start();
    control.approveDeviceCode(code.user_code, "mate-maintenance");
    control.scriptNextDevicePoll("slow_down");
    expect((await poll()).json.error).toBe("slow_down");
    expect((await poll()).json.access_token).toBeTruthy();
  });

  it("lists the open codes so a test or an agent can find the one the SPA shows", async () => {
    const { control, code } = await start();
    expect(control.deviceCodes()).toEqual([
      expect.objectContaining({ userCode: code.user_code, status: "pending" }),
    ]);
  });

  it("will not approve a code for a user it does not know", async () => {
    const { control, code } = await start();
    expect(() => control.approveDeviceCode(code.user_code, "ghost-user")).toThrow(/No Staff user/);
  });
});

describe("tokens and refresh", () => {
  async function signedIn() {
    const test = await start();
    test.control.approveDeviceCode(test.code.user_code, "mate-maintenance");
    const tokens = (await test.poll()).json;
    const refresh = (refreshToken: string) =>
      test.client.web("POST", "/login/oauth/access_token", {
        form: {
          client_id: TEST_STAFF_CLIENT_ID,
          grant_type: "refresh_token",
          refresh_token: refreshToken,
        },
      });
    return { ...test, tokens, refresh };
  }

  it("expires the access token after 8 hours of the fake clock", async () => {
    const { control, tokens, client, org, repo } = await signedIn();
    control.advanceClock(8 * 3_600_000 + 1000);
    const reply = await client.github("GET", `/repos/${org}/${repo}`, {
      token: tokens.access_token,
    });
    expect(reply.status).toBe(401);
  });

  it("refreshes without a client secret, and kills the old access and refresh tokens", async () => {
    const { tokens, refresh, client, org, repo } = await signedIn();
    const fresh = await refresh(tokens.refresh_token);
    expect(fresh.json.access_token).toMatch(/^ghu_/);
    expect(fresh.json.access_token).not.toBe(tokens.access_token);
    expect(fresh.json.refresh_token).not.toBe(tokens.refresh_token);

    expect(
      (await client.github("GET", `/repos/${org}/${repo}`, { token: tokens.access_token })).status,
    ).toBe(401);
    expect(
      (await client.github("GET", `/repos/${org}/${repo}`, { token: fresh.json.access_token }))
        .status,
    ).toBe(200);
    // Single use: a second tab refreshing with the old token gets an error and must sign in again.
    expect((await refresh(tokens.refresh_token)).json.error).toBe("bad_refresh_token");
  });

  it("refuses a refresh token it never issued", async () => {
    const { refresh } = await signedIn();
    expect((await refresh("ghr_nope")).json.error).toBe("bad_refresh_token");
  });
});
