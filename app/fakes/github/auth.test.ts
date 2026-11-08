import { describe, expect, it } from "vitest";
import { signTestJwt } from "../testing/jwt.ts";
import { createTestWorld } from "../testing/world.ts";

// The fake GitHub's identity and permission behaviour, at its HTTP seam (SPEC 2.4, 3.3). Fixtures follow
// docs.github.com: the repo `permissions` object per role, a 404 for non-members, the App JWT rules.

describe("repo GET and the permissions object", () => {
  it.each([
    ["read", { admin: false, maintain: false, push: false, triage: false, pull: true }],
    ["triage", { admin: false, maintain: false, push: false, triage: true, pull: true }],
    ["write", { admin: false, maintain: false, push: true, triage: true, pull: true }],
    ["maintain", { admin: false, maintain: true, push: true, triage: true, pull: true }],
    ["admin", { admin: true, maintain: true, push: true, triage: true, pull: true }],
  ] as const)("reports the %s role's permissions", async (role, permissions) => {
    const { world, client, org, repo } = await createTestWorld();
    const { token } = world.control.addStaff({ login: `user-${role}`, role });
    const reply = await client.github("GET", `/repos/${org}/${repo}`, { token });
    expect(reply.status).toBe(200);
    expect(reply.json.permissions).toEqual(permissions);
    expect(reply.json.full_name).toBe(`${org}/${repo}`);
  });

  it("answers 404, as GitHub does for a private repo, to a signed-in non-member", async () => {
    const { world, client, org, repo } = await createTestWorld();
    const { token } = world.control.addStaff({ login: "outsider", role: "none" });
    const reply = await client.github("GET", `/repos/${org}/${repo}`, { token });
    expect(reply.status).toBe(404);
    expect(reply.json.message).toBe("Not Found");
  });

  it("answers 404 for a repo that does not exist", async () => {
    const { world, client, org } = await createTestWorld();
    const { token } = world.control.addStaff({ login: "admin-user", role: "admin" });
    expect((await client.github("GET", `/repos/${org}/other`, { token })).status).toBe(404);
  });

  it("answers 401 without a token and with an unknown one", async () => {
    const { client, org, repo } = await createTestWorld();
    const missing = await client.github("GET", `/repos/${org}/${repo}`);
    expect(missing.status).toBe(401);
    const unknown = await client.github("GET", `/repos/${org}/${repo}`, { token: "ghu_nope" });
    expect(unknown.status).toBe(401);
    expect(unknown.json.message).toBe("Bad credentials");
  });

  it("accepts the legacy `token` scheme as well as Bearer", async () => {
    const { world, client, org, repo } = await createTestWorld();
    const { token } = world.control.addStaff({ login: "someone", role: "read" });
    const reply = await client.github("GET", `/repos/${org}/${repo}`, {
      headers: { authorization: `token ${token}` },
    });
    expect(reply.status).toBe(200);
  });

  it("is stricter than GitHub about the headers our clients must send", async () => {
    const { world, client, org, repo } = await createTestWorld();
    const { token } = world.control.addStaff({ login: "someone", role: "read" });
    // GitHub rejects a missing User-Agent with 403; Workers' fetch sends none.
    const noAgent = await client.github("GET", `/repos/${org}/${repo}`, {
      token,
      omitUserAgent: true,
    });
    expect(noAgent.status).toBe(403);
    // GitHub would default the version; the fake insists the clients pin it (one shared constant).
    const noVersion = await client.github("GET", `/repos/${org}/${repo}`, {
      token,
      omitVersion: true,
    });
    expect(noVersion.status).toBe(400);
    expect(noVersion.json.message).toContain("X-GitHub-Api-Version");
  });

  it("answers a CORS preflight like api.github.com, so the SPA's cross-origin calls are exercised", async () => {
    const { client } = await createTestWorld();
    const preflight = await client.github("OPTIONS", "/repos/x/y", {
      headers: {
        origin: "http://localhost:5173",
        "access-control-request-method": "GET",
        "access-control-request-headers": "authorization,x-github-api-version",
      },
    });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-origin")).toBe("*");
    const allowed = preflight.headers.get("access-control-allow-headers")?.toLowerCase() ?? "";
    expect(allowed).toContain("authorization");
    expect(allowed).toContain("x-github-api-version");
  });

  it("exposes Link to the browser on ordinary responses", async () => {
    const { world, client, org, repo } = await createTestWorld();
    const { token } = world.control.addStaff({ login: "someone", role: "read" });
    const reply = await client.github("GET", `/repos/${org}/${repo}`, { token });
    expect(reply.headers.get("access-control-allow-origin")).toBe("*");
    expect(reply.headers.get("access-control-expose-headers")).toContain("Link");
  });
});

describe("installation-token exchange", () => {
  async function exchange(
    overrides: Parameters<typeof signTestJwt>[1] | null = {},
    mutate = (jwt: string) => jwt,
  ) {
    const test = await createTestWorld();
    const jwt =
      overrides === null
        ? "not-a-jwt"
        : mutate(
            await signTestJwt(test.keys.privateKeyPkcs8, {
              iss: String(test.bot.appId),
              ...overrides,
            }),
          );
    const reply = await test.client.github(
      "POST",
      `/app/installations/${test.bot.installationId}/access_tokens`,
      { token: jwt },
    );
    return { ...test, reply };
  }

  it("mints a one-hour token for a valid JWT, and that token reads the repo", async () => {
    const { reply, client, org, repo, world } = await exchange();
    expect(reply.status).toBe(201);
    expect(reply.json.token).toMatch(/^ghs_/);
    expect(Date.parse(reply.json.expires_at) - world.control.clockNow()).toBeCloseTo(3_600_000, -4);
    expect(reply.json.permissions).toMatchObject({ issues: "write", metadata: "read" });
    const repoReply = await client.github("GET", `/repos/${org}/${repo}`, {
      token: reply.json.token,
    });
    expect(repoReply.status).toBe(200);
  });

  it("accepts the client id as `iss` as well as the App id", async () => {
    const test = await createTestWorld();
    const jwt = await signTestJwt(test.keys.privateKeyPkcs8, { iss: test.bot.clientId });
    const reply = await test.client.github(
      "POST",
      `/app/installations/${test.bot.installationId}/access_tokens`,
      { token: jwt },
    );
    expect(reply.status).toBe(201);
  });

  it.each([
    ["a malformed token", null, undefined],
    ["a JWT for another App", { iss: "999" }, undefined],
    [
      "a JWT that expires more than 10 minutes ahead",
      { exp: Math.floor(Date.now() / 1000) + 700 },
      undefined,
    ],
    [
      "an expired JWT",
      { iat: Math.floor(Date.now() / 1000) - 900, exp: Math.floor(Date.now() / 1000) - 300 },
      undefined,
    ],
    ["a JWT with a broken signature", {}, (jwt: string) => `${jwt.slice(0, -4)}AAAA`],
  ] as const)("refuses %s with 401", async (_name, overrides, mutate) => {
    const { reply } = await exchange(overrides as never, mutate);
    expect(reply.status).toBe(401);
    expect(reply.json.message).toBeTruthy();
  });

  it("refuses a JWT signed with another algorithm", async () => {
    const test = await createTestWorld();
    const jwt = await signTestJwt(
      test.keys.privateKeyPkcs8,
      { iss: String(test.bot.appId) },
      undefined,
      { alg: "none", typ: "JWT" },
    );
    const reply = await test.client.github(
      "POST",
      `/app/installations/${test.bot.installationId}/access_tokens`,
      { token: jwt },
    );
    expect(reply.status).toBe(401);
  });

  it("answers 404 for an installation that does not exist", async () => {
    const test = await createTestWorld();
    const jwt = await signTestJwt(test.keys.privateKeyPkcs8, { iss: String(test.bot.appId) });
    const reply = await test.client.github("POST", "/app/installations/1/access_tokens", {
      token: jwt,
    });
    expect(reply.status).toBe(404);
  });

  it("lets an installation token expire after an hour of the fake clock", async () => {
    const { reply, client, org, repo, world } = await exchange();
    world.control.advanceClock(61 * 60_000);
    const expired = await client.github("GET", `/repos/${org}/${repo}`, {
      token: reply.json.token,
    });
    expect(expired.status).toBe(401);
  });

  it("does not let an installation token mint another token, and a JWT is no repo credential", async () => {
    const { reply, client, bot, org, repo } = await exchange();
    const again = await client.github(
      "POST",
      `/app/installations/${bot.installationId}/access_tokens`,
      {
        token: reply.json.token,
      },
    );
    expect(again.status).toBe(401);
    const test = await createTestWorld();
    const jwt = await signTestJwt(test.keys.privateKeyPkcs8, { iss: String(test.bot.appId) });
    const asRepo = await test.client.github("GET", `/repos/${org}/${repo}`, { token: jwt });
    expect(asRepo.status).toBe(401);
  });
});

describe("authentic identities", () => {
  it("makes the Bot a type Bot user with a numeric id of its own and a [bot] login", async () => {
    const { world, client, bot } = await createTestWorld();
    const { token } = world.control.addStaff({ login: "alice", role: "read" });
    const reply = await client.github("GET", `/users/${encodeURIComponent(`${bot.slug}[bot]`)}`, {
      token,
    });
    expect(reply.status).toBe(200);
    expect(reply.json.login).toBe(`${bot.slug}[bot]`);
    expect(reply.json.type).toBe("Bot");
    expect(Number.isInteger(reply.json.id)).toBe(true);
    // The account id is not the App id (SPEC 4.3 pins the Bot by the account id).
    expect(reply.json.id).not.toBe(bot.appId);
  });

  it("gives each Staff token its own user", async () => {
    const { world, client } = await createTestWorld();
    const alice = world.control.addStaff({ login: "alice", role: "triage" });
    const bob = world.control.addStaff({ login: "bob", role: "admin" });
    const a = await client.github("GET", "/user", { token: alice.token });
    const b = await client.github("GET", "/user", { token: bob.token });
    expect(a.json).toMatchObject({ login: "alice", type: "User" });
    expect(b.json).toMatchObject({ login: "bob", type: "User" });
    expect(a.json.id).not.toBe(b.json.id);
  });
});
