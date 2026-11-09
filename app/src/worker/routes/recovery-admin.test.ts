import { env, exports } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { correlationMarker } from "@shared/reports/body.ts";
import { referenceConfig } from "@shared/seed/reference-config.ts";
import { addToAllowlist, fakeWorld } from "../testing/world.ts";
import { sha256Hex } from "../util/crypto.ts";

// The operator procedure (ticket #24, SPEC 4.1): an Admin-gated Worker endpoint to list, inspect, associate a
// verified existing issue and discard a retained attempt. The CLI is a thin client over these four endpoints.

let listed = "";
let counter = 0;
let ip = 0;

async function call(
  method: "GET" | "POST",
  path: string,
  options: { token?: string; body?: unknown; query?: Record<string, string> } = {},
) {
  const url = new URL(`https://reports.test${path}`);
  for (const [key, value] of Object.entries(options.query ?? {})) url.searchParams.set(key, value);
  const response = await exports.default.fetch(url, {
    method,
    headers: {
      "content-type": "application/json",
      "cf-connecting-ip": `198.51.102.${++ip}`,
      ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
    },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });
  return { status: response.status, body: await response.json<Record<string, any>>() };
}

const credential = () => crypto.randomUUID().replace(/-/g, "") + "abcdefghij";

/** An attempt whose create failed with nothing on GitHub: unresolved after its first resume. */
async function unresolvedAttempt() {
  const world = fakeWorld();
  world.control.holdWebhooks();
  world.control.addFault({
    service: "github",
    method: "POST",
    path: "^/repos/.+/issues$",
    effect: { type: "status", status: 502 },
  });
  const gate = env.EMAIL_GATE.getByName(await sha256Hex(listed));
  expect((await call("POST", "/api/reports/code", { body: { email: listed } })).status).toBe(200);
  let code = "";
  for (let attempt = 0; attempt < 100 && !code; attempt++) {
    code = /\b(\d{6})\b/.exec(world.control.outbox(listed).at(-1)?.text ?? "")?.[1] ?? "";
    if (!code) await new Promise((resolve) => setTimeout(resolve, 30));
  }
  const secret = credential();
  const submitted = await call("POST", "/api/reports/submit", {
    body: {
      email: listed,
      code,
      credential: secret,
      category: "elevator",
      location: "stairwell",
      title: "Elakadt a lift",
      description: "A lift megáll.",
    },
  });
  expect(submitted.status).toBe(503);
  const resumed = await call("POST", "/api/reports/resume", {
    body: { email: listed, credential: secret },
  });
  expect(resumed.body["status"]).toBe("needs_help");
  const marker = await runInDurableObject(
    gate,
    (_gate, state) => state.storage.kv.get<Record<string, any>>("attempt")?.["marker"] as string,
  );
  return { secret, reference: resumed.body["reference"] as string, marker };
}

beforeEach(async () => {
  listed = `operator.${++counter}@example.hu`;
  await env.KV.put("config", JSON.stringify(referenceConfig));
  await addToAllowlist(listed, "Kiss Anna");
});

afterEach(async () => {
  await env.KV.delete("config");
  for (const prefix of ["allowlist:", "issue-email:", "status-token:", "issue-token:"]) {
    for (const { name } of (await env.KV.list({ prefix })).keys) await env.KV.delete(name);
  }
});

describe("the recovery operator endpoints", () => {
  it("answer 401 without a token and 403 to anyone below Admin", async () => {
    const triage = fakeWorld().control.addStaff({ login: "mate", role: "triage" });
    expect((await call("GET", "/api/admin/recovery")).status).toBe(401);
    expect((await call("GET", "/api/admin/recovery", { token: triage.token })).status).toBe(403);
    const body = { reference: "ABCD-1234" };
    expect(
      (await call("POST", "/api/admin/recovery/discard", { token: triage.token, body })).status,
    ).toBe(403);
    expect(
      (
        await call("POST", "/api/admin/recovery/associate", {
          token: triage.token,
          body: { ...body, issueNumber: 1 },
        })
      ).status,
    ).toBe(403);
  });

  it("list and inspect an unresolved attempt by reference or by email", async () => {
    const admin = fakeWorld().control.addStaff({ login: "gondnok", role: "admin" });
    const { reference, marker } = await unresolvedAttempt();

    const listing = await call("GET", "/api/admin/recovery", { token: admin.token });
    expect(listing.body["attempts"]).toEqual([
      expect.objectContaining({
        reference,
        emailHash: await sha256Hex(listed),
        phase: "unresolved",
      }),
    ]);
    // The list names no address and no payload
    expect(JSON.stringify(listing.body)).not.toContain(listed);

    for (const query of [{ reference }, { email: listed.toUpperCase() }] as Record<
      string,
      string
    >[]) {
      const detail = await call("GET", "/api/admin/recovery/attempt", {
        token: admin.token,
        query,
      });
      expect(detail.status).toBe(200);
      expect(detail.body).toMatchObject({
        reference,
        email: listed,
        phase: "unresolved",
        issueNumber: null,
        markerLine: correlationMarker(marker),
        title: "Elakadt a lift",
        matches: [],
      });
    }
    const unknown = await call("GET", "/api/admin/recovery/attempt", {
      token: admin.token,
      query: { reference: "0000-0000" },
    });
    expect(unknown.status).toBe(404);
    // Exactly one of the two selectors
    const both = await call("GET", "/api/admin/recovery/attempt", {
      token: admin.token,
      query: { reference, email: listed },
    });
    expect(both.status).toBe(400);
  });

  it("associate a verified existing issue: it finalizes, the Reporter's tab completes, nothing is created", async () => {
    const world = fakeWorld();
    const admin = world.control.addStaff({ login: "gondnok", role: "admin" });
    const { secret, reference } = await unresolvedAttempt();
    // The operator found the Report on GitHub (its marker was edited, so the scan could not)
    const { number } = world.control.createReport({
      title: "Elakadt a lift",
      body: "kézzel javítva",
    });

    const done = await call("POST", "/api/admin/recovery/associate", {
      token: admin.token,
      body: { reference, issueNumber: number },
    });
    expect(done).toEqual({ status: 200, body: { outcome: "complete", number } });
    expect(await env.KV.get(`issue-email:${number}`)).toBe(listed);
    expect(world.control.summary().issues).toBe(1);
    const remaining = await call("GET", "/api/admin/recovery", { token: admin.token });
    expect(remaining.body["attempts"]).toEqual([]);

    const resumed = await call("POST", "/api/reports/resume", {
      body: { email: listed, credential: secret },
    });
    expect(resumed.body).toMatchObject({ status: "complete", number });
  });

  it("refuse an issue that is missing, a pull request, or already linked", async () => {
    const world = fakeWorld();
    const admin = world.control.addStaff({ login: "gondnok", role: "admin" });
    const { reference } = await unresolvedAttempt();
    const pull = world.control.createReport({ title: "PR", pullRequest: true });
    const linked = world.control.createReport({ title: "Már összekötve" });
    await env.KV.put(`issue-email:${linked.number}`, "someone.else@example.hu");

    for (const issueNumber of [999, pull.number, linked.number]) {
      const refused = await call("POST", "/api/admin/recovery/associate", {
        token: admin.token,
        body: { reference, issueNumber },
      });
      expect(refused, String(issueNumber)).toEqual({
        status: 422,
        body: { error: { code: "issue_unverified" } },
      });
    }
    const still = await call("GET", "/api/admin/recovery/attempt", {
      token: admin.token,
      query: { reference },
    });
    expect(still.body["phase"]).toBe("unresolved");
  });

  it("discard the attempt and its registry entry, and the address can submit again", async () => {
    const admin = fakeWorld().control.addStaff({ login: "gondnok", role: "admin" });
    const { secret, reference } = await unresolvedAttempt();

    const discarded = await call("POST", "/api/admin/recovery/discard", {
      token: admin.token,
      body: { reference },
    });
    expect(discarded).toEqual({ status: 200, body: { discarded: true } });
    const listing = await call("GET", "/api/admin/recovery", { token: admin.token });
    expect(listing.body["attempts"]).toEqual([]);
    const resumed = await call("POST", "/api/reports/resume", {
      body: { email: listed, credential: secret },
    });
    expect(resumed.status).toBe(404);
    const again = await call("POST", "/api/admin/recovery/discard", {
      token: admin.token,
      body: { reference },
    });
    expect(again.status).toBe(404);
  });
});
