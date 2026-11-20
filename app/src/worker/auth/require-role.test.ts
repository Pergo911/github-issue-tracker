import { env } from "cloudflare:workers";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineEndpoint, type } from "@shared/api/contract.ts";
import type { StaffRole } from "@shared/github/roles.ts";
import { installApiErrorHandling } from "../api/errors.ts";
import { registerEndpoint } from "../api/register.ts";
import { fakeWorld } from "../testing/world.ts";
import { requireRole, type StaffCaller } from "./require-role.ts";

// `requireRole` (SPEC 2.4): the caller's GitHub token, checked against the repo `permissions` object, on every
// gated endpoint, enforced by the contract so a gated endpoint cannot be registered without it.

interface Whoami {
  role: StaffRole;
  login: string;
}

const gated = (role: StaffRole) =>
  defineEndpoint({
    method: "GET",
    path: "/api/test/whoami",
    request: z.object({}),
    response: type<Whoami>(),
    errors: {},
    role,
  });

function appFor(role: StaffRole, ran: { count: number } = { count: 0 }) {
  const app = new Hono<{ Bindings: Env }>();
  installApiErrorHandling(app);
  registerEndpoint(app, gated(role), ({ caller }) => {
    ran.count += 1;
    return { role: caller.role, login: caller.login };
  });
  const call = (token?: string) =>
    app.fetch(
      new Request("https://reports.test/api/test/whoami", {
        headers: token === undefined ? {} : { authorization: `Bearer ${token}` },
      }),
      env,
    );
  return { app, call, ran };
}

const staff = (login: string, role: "none" | "read" | "triage" | "write" | "maintain" | "admin") =>
  fakeWorld().control.addStaff({ login, role }).token;

describe("which role each repo role gets", () => {
  it.each([
    ["read", "viewer"],
    ["triage", "maintenance"],
    ["write", "maintenance"],
    ["maintain", "maintenance"],
    ["admin", "admin"],
  ] as const)("resolves the repo %s role to %s", async (repoRole, expected) => {
    const { call } = appFor("viewer");
    const response = await call(staff(`user-${repoRole}`, repoRole));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ role: expected, login: `user-${repoRole}` });
  });
});

describe("the role an endpoint requires", () => {
  const matrix: [StaffRole, string, "read" | "triage" | "admin", number][] = [
    ["viewer", "a Viewer", "read", 200],
    ["viewer", "Maintenance staff", "triage", 200],
    ["viewer", "a System admin", "admin", 200],
    ["maintenance", "a Viewer", "read", 403],
    ["maintenance", "Maintenance staff", "triage", 200],
    ["maintenance", "a System admin", "admin", 200],
    ["admin", "a Viewer", "read", 403],
    ["admin", "Maintenance staff", "triage", 403],
    ["admin", "a System admin", "admin", 200],
  ];

  it.each(matrix)("%s endpoint, called by %s %s", async (required, _who, repoRole, status) => {
    const ran = { count: 0 };
    const { call } = appFor(required, ran);
    const response = await call(staff("caller", repoRole));
    expect(response.status).toBe(status);
    if (status === 403) {
      expect(await response.json()).toEqual({ error: { code: "forbidden" } });
      expect(ran.count).toBe(0);
    } else {
      await response.arrayBuffer();
      expect(ran.count).toBe(1);
    }
  });
});

describe("who is denied", () => {
  it("denies a signed-in non-member: GitHub answers 404 for a private repo, and 404 means deny", async () => {
    const ran = { count: 0 };
    const { call } = appFor("viewer", ran);
    const response = await call(staff("outsider", "none"));
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: { code: "forbidden" } });
    expect(ran.count).toBe(0);
  });

  it("denies a 200 answer that has no permissions object", async () => {
    const { call, ran } = appFor("viewer");
    const token = staff("someone", "admin");
    fakeWorld().control.addFault({
      service: "github",
      path: "^/repos/[^/]+/[^/]+$",
      effect: { type: "status", status: 200, body: { full_name: "fake-org/reports" } },
    });
    const response = await call(token);
    expect(response.status).toBe(403);
    expect(ran.count).toBe(0);
  });

  it("answers 401 unauthorized without a token, with a malformed header, with an unknown token and with an expired one", async () => {
    const ran = { count: 0 };
    const { app, call } = appFor("viewer", ran);
    expect((await call()).status).toBe(401);
    const malformed = await app.fetch(
      new Request("https://reports.test/api/test/whoami", {
        headers: { authorization: "Basic abc" },
      }),
      env,
    );
    expect(malformed.status).toBe(401);
    expect(await (await call("ghu_not_issued")).json()).toEqual({
      error: { code: "unauthorized" },
    });

    const fresh = staff("someone", "admin");
    expect((await call(fresh)).status).toBe(200);
    // A staff token that GitHub no longer honours (expired or revoked) is a 401, not a 403.
    fakeWorld().control.reset();
    expect((await call(fresh)).status).toBe(401);
    expect(ran.count).toBe(1);
  });

  it("fails closed, with 502 upstream_unavailable, when GitHub cannot be asked", async () => {
    const ran = { count: 0 };
    const { call } = appFor("viewer", ran);
    const token = staff("someone", "admin");
    fakeWorld().control.addFault({
      service: "github",
      effect: { type: "status", status: 503 },
      times: null,
    });
    const response = await call(token);
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: { code: "upstream_unavailable" } });
    fakeWorld().control.clearFaults();
    fakeWorld().control.addFault({
      service: "github",
      effect: { type: "lost-response" },
      times: null,
    });
    expect((await call(token)).status).toBe(502);
    expect(ran.count).toBe(0);
  });

  it("checks the caller's own token, never the Bot's: the fake sees the staff token on the repo read", async () => {
    const seen: string[] = [];
    const world = fakeWorld();
    const original = world.handle;
    world.handle = (request) => {
      const header = request.headers.get("authorization");
      if (header) seen.push(header);
      return original(request);
    };
    try {
      const token = staff("someone", "triage");
      await appFor("viewer").call(token);
    } finally {
      world.handle = original;
    }
    expect(seen).toContain(`Bearer ${fakeWorld().control.summary().staff[0]!.token}`);
    expect(seen.every((header) => !header.includes("ghs_"))).toBe(true);
  });
});

describe("gated endpoints cannot forget the gate", () => {
  it("runs the gate for any endpoint that declares a role, before validation and before the handler", async () => {
    const endpoint = defineEndpoint({
      method: "POST",
      path: "/api/test/secret",
      request: z.object({ name: z.string() }),
      response: type<{ ok: true }>(),
      errors: {},
      role: "admin",
    });
    const ran = { count: 0 };
    const app = new Hono<{ Bindings: Env }>();
    installApiErrorHandling(app);
    registerEndpoint(app, endpoint, () => {
      ran.count += 1;
      return { ok: true as const };
    });
    const post = (token: string | undefined, body: unknown) =>
      app.fetch(
        new Request("https://reports.test/api/test/secret", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(token ? { authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify(body),
        }),
        env,
      );
    // No token: 401 even for a body that would not validate (nothing is revealed to the unauthenticated).
    expect((await post(undefined, {})).status).toBe(401);
    expect((await post(staff("v", "read"), { name: "x" })).status).toBe(403);
    expect((await post(staff("a", "admin"), {})).status).toBe(400);
    expect((await post(staff("a", "admin"), { name: "x" })).status).toBe(200);
    expect(ran.count).toBe(1);
  });

  it("leaves an endpoint without a role public, and gives its handler no caller", async () => {
    const endpoint = defineEndpoint({
      method: "GET",
      path: "/api/test/open",
      request: z.object({}),
      response: type<{ ok: true }>(),
      errors: {},
    });
    const app = new Hono<{ Bindings: Env }>();
    registerEndpoint(app, endpoint, (context) => {
      // A public endpoint's handler has no caller: the type says so.
      const caller: undefined = context.caller;
      expect(caller).toBeUndefined();
      return { ok: true as const };
    });
    const response = await app.fetch(new Request("https://reports.test/api/test/open"), env);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });

  it("hands a gated handler the caller, typed", async () => {
    const endpoint = gated("viewer");
    const app = new Hono<{ Bindings: Env }>();
    let seen: StaffCaller | undefined;
    registerEndpoint(app, endpoint, ({ caller }) => {
      seen = caller;
      return { role: caller.role, login: caller.login };
    });
    const token = staff("typed", "admin");
    await app.fetch(
      new Request("https://reports.test/api/test/whoami", {
        headers: { authorization: `Bearer ${token}` },
      }),
      env,
    );
    expect(seen).toEqual({ role: "admin", login: "typed", token });
  });

  it("is also usable as plain middleware", async () => {
    const app = new Hono<{ Bindings: Env }>();
    app.get("/x", requireRole("maintenance"), (c) => c.text("in"));
    const call = (token: string) =>
      app.fetch(
        new Request("https://reports.test/x", { headers: { authorization: `Bearer ${token}` } }),
        env,
      );
    expect((await call(staff("m", "triage"))).status).toBe(200);
    expect((await call(staff("v2", "read"))).status).toBe(403);
  });
});
