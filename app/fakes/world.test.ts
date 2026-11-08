import { describe, expect, it } from "vitest";
import { asAsync, remoteControl } from "./control.ts";
import { castedWorld } from "./testing/bot.ts";
import { createTestWorld } from "./testing/world.ts";
import { ConnectionLost } from "./world.ts";

// Fault injection, the Allowlist-email invariant, the seed and the control API: the parts of the local world
// that are not one of the two services.

async function setup() {
  const test = await createTestWorld();
  const cast = await castedWorld(test);
  return { ...test, ...cast };
}

describe("fault injection", () => {
  it("answers a chosen status once, and changes nothing", async () => {
    const { client, control, bot, path } = await setup();
    control.addFault({
      service: "github",
      method: "POST",
      path: "^/repos/.+/issues$",
      effect: { type: "status", status: 503 },
    });
    const failed = await client.github("POST", path("/issues"), {
      token: bot,
      json: { title: "t" },
    });
    expect(failed.status).toBe(503);
    const retry = await client.github("POST", path("/issues"), {
      token: bot,
      json: { title: "t" },
    });
    expect(retry.status).toBe(201);
    expect(retry.json.number).toBe(1);
  });

  it("can carry a body and headers, e.g. a secondary rate limit", async () => {
    const { client, control, bot, path } = await setup();
    control.addFault({
      service: "github",
      effect: {
        type: "status",
        status: 403,
        body: { message: "You have exceeded a secondary rate limit." },
        headers: { "retry-after": "60" },
      },
    });
    const reply = await client.github("GET", path(), { token: bot });
    expect(reply.status).toBe(403);
    expect(reply.headers.get("retry-after")).toBe("60");
    expect(reply.json.message).toContain("secondary rate limit");
  });

  it("applies the write, then drops the connection: created, but the response was lost", async () => {
    const { client, control, bot, read, path } = await setup();
    control.addFault({
      service: "github",
      method: "POST",
      path: "/issues$",
      effect: { type: "lost-response" },
    });
    await expect(
      client.github("POST", path("/issues"), { token: bot, json: { title: "ghost" } }),
    ).rejects.toBeInstanceOf(ConnectionLost);
    const list = await client.github("GET", path("/issues"), { token: read });
    expect(list.json.map((issue: { title: string }) => issue.title)).toEqual(["ghost"]);
  });

  it("holds a request until the caller gives up: a timeout", async () => {
    const { world, control, bot, origin, path } = await setup();
    control.addFault({ service: "github", effect: { type: "timeout" } });
    const aborter = new AbortController();
    const pending = world.handle(
      new Request(`${origin}/github${path()}`, {
        headers: {
          authorization: `Bearer ${bot}`,
          "user-agent": "t",
          "x-github-api-version": "2022-11-28",
        },
        signal: aborter.signal,
      }),
    );
    setTimeout(() => aborter.abort(), 20);
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });

  it("can skip the first matching requests, hit every one until cleared, and be cleared", async () => {
    const { client, control, bot, path } = await setup();
    control.addFault({
      service: "github",
      effect: { type: "status", status: 500 },
      skip: 1,
      times: null,
    });
    expect((await client.github("GET", path(), { token: bot })).status).toBe(200);
    expect((await client.github("GET", path(), { token: bot })).status).toBe(500);
    expect((await client.github("GET", path(), { token: bot })).status).toBe(500);
    control.clearFaults();
    expect((await client.github("GET", path(), { token: bot })).status).toBe(200);
  });

  it("only hits the service and path it names", async () => {
    const { client, control, bot, path } = await setup();
    control.addFault({ service: "resend", effect: { type: "status", status: 500 } });
    control.addFault({
      service: "github",
      path: "/labels$",
      effect: { type: "status", status: 500 },
    });
    expect((await client.github("GET", path(), { token: bot })).status).toBe(200);
    expect((await client.github("GET", path("/labels"), { token: bot })).status).toBe(500);
  });

  it("also hits the device-flow and Resend fakes", async () => {
    const { client, control } = await setup();
    control.addFault({ service: "github-web", effect: { type: "status", status: 502 } });
    const web = await client.web("POST", "/login/device/code", { form: { client_id: "x" } });
    expect(web.status).toBe(502);
    control.addFault({ service: "resend", effect: { type: "status", status: 503 } });
    const mail = await client.resend("POST", "/emails", {
      token: "re_x",
      json: { from: "a@b.hu", to: "c@d.hu", subject: "s", text: "t" },
    });
    expect(mail.status).toBe(503);
    expect(mail.json).toMatchObject({ statusCode: 503, name: "application_error" });
  });
});

describe("the invariant: no Allowlist email address is ever written to GitHub", () => {
  const address = "resident@example.hu";

  it("passes when no address appears in any write", async () => {
    const { client, control, bot, path } = await setup();
    control.protectEmail(address);
    await client.github("POST", path("/issues"), {
      token: bot,
      json: { title: "Leaking tap", body: "Floor 2" },
    });
    expect(control.takeViolations()).toEqual([]);
  });

  it.each([
    [
      "an issue body",
      (path: (s?: string) => string) => [
        "POST",
        path("/issues"),
        { title: "t", body: `contact ${address}` },
      ],
    ],
    [
      "an issue title",
      (path: (s?: string) => string) => ["POST", path("/issues"), { title: address }],
    ],
    [
      "a label name",
      (path: (s?: string) => string) => ["POST", path("/labels"), { name: `reporter:${address}` }],
    ],
    [
      "different letter case",
      (path: (s?: string) => string) => [
        "POST",
        path("/issues"),
        { title: "t", body: "RESIDENT@Example.HU" },
      ],
    ],
  ] as const)("is caught in %s", async (_name, build) => {
    const { client, control, bot, path } = await setup();
    control.protectEmail(address);
    const [method, target, json] = build(path) as [string, string, unknown];
    await client.github(method, target, { token: bot, json });
    const violations = control.takeViolations();
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({ method, address, where: "body" });
  });

  it("is caught when the address is spelled with JSON escapes in the raw body", async () => {
    const { world, control, bot, origin, path } = await setup();
    const backslash = String.fromCharCode(92);
    control.protectEmail(address);
    await world.handle(
      new Request(`${origin}/github${path("/issues")}`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${bot}`,
          "user-agent": "t",
          "x-github-api-version": "2022-11-28",
          "content-type": "application/json",
        },
        // "resident\u0040example.hu" in the JSON text decodes to the address.
        body: `{"title":"t","body":"resident${backslash}u0040example.hu"}`,
      }),
    );
    expect(control.takeViolations()).toHaveLength(1);
  });

  it("is caught in a comment, and in a URL", async () => {
    const { client, control, bot, path, create } = await (async () => {
      const s = await setup();
      return {
        ...s,
        create: (json: Record<string, unknown>) =>
          s.client.github("POST", s.path("/issues"), { token: s.bot, json }),
      };
    })();
    await create({ title: "t" });
    control.protectEmail(address);
    await client.github("POST", path("/issues/1/comments"), {
      token: bot,
      json: { body: `Reporter: ${address}` },
    });
    await client.github("DELETE", path(`/labels/${encodeURIComponent(address)}`), { token: bot });
    expect(control.takeViolations().map((v) => v.where)).toEqual(["body", "url"]);
  });

  it("is checked even for a write that a fault then fails", async () => {
    const { client, control, bot, path } = await setup();
    control.protectEmail(address);
    control.addFault({ service: "github", effect: { type: "status", status: 500 } });
    await client.github("POST", path("/issues"), { token: bot, json: { title: address } });
    expect(control.takeViolations()).toHaveLength(1);
  });

  it("ignores reads, and empties its list once taken", async () => {
    const { client, control, bot, path } = await setup();
    control.protectEmail(address);
    await client.github("GET", path("/issues"), { token: bot, query: { labels: address } });
    expect(control.takeViolations()).toEqual([]);
    await client.github("POST", path("/issues"), { token: bot, json: { title: address } });
    expect(control.takeViolations()).toHaveLength(1);
    expect(control.takeViolations()).toEqual([]);
  });
});

describe("seed and reset", () => {
  it("seeds the Appendix A labels, one Staff user per role and a few Reports", async () => {
    const { client, control } = await setup();
    const { staff, reports } = control.seed();
    expect(staff.map((member) => [member.login, member.role])).toEqual(
      expect.arrayContaining([
        ["vera-viewer", "read"],
        ["mate-maintenance", "triage"],
        ["adam-admin", "admin"],
        ["nora-outsider", "none"],
      ]),
    );
    expect(reports.length).toBeGreaterThanOrEqual(3);
    const admin = staff.find((member) => member.role === "admin")!;
    const labels = await client.github("GET", "/repos/fake-org/reports/labels", {
      token: admin.token,
      query: { per_page: 100 },
    });
    const names = labels.json.map((label: { name: string }) => label.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "category:plumbing",
        "location:floor-2",
        "priority:urgent",
        "status:new",
        "status:in-progress",
      ]),
    );
    const open = await client.github("GET", "/repos/fake-org/reports/issues", {
      token: admin.token,
    });
    expect(open.json.length).toBeGreaterThanOrEqual(2);
    const closed = await client.github("GET", "/repos/fake-org/reports/issues", {
      token: admin.token,
      query: { state: "closed" },
    });
    expect(closed.json).toHaveLength(1);
  });

  it("resets everything, including tokens, Reports, mail, faults and the clock", async () => {
    const { client, control, bot, path } = await setup();
    const { staff } = control.seed();
    control.advanceClock(1_000_000);
    control.addFault({ service: "github", effect: { type: "status", status: 500 }, times: null });
    control.protectEmail("x@y.hu");
    control.reset();
    expect(control.summary()).toMatchObject({
      issues: 0,
      labels: 0,
      mails: 0,
      faults: 0,
      staff: [],
    });
    expect(Math.abs(control.clockNow() - Date.now())).toBeLessThan(1000);
    expect((await client.github("GET", path(), { token: staff[0]!.token })).status).toBe(401);
    // The Bot's installation token was minted before the reset and is gone too: the Worker must mint again.
    expect((await client.github("GET", path(), { token: bot })).status).toBe(401);
    expect(control.takeViolations()).toEqual([]);
  });
});

describe("the control API", () => {
  it("is the same interface over HTTP as in process", async () => {
    const { world, origin } = await setup();
    const remote = remoteControl(`${origin}/control`, (input, init) =>
      world.handle(new Request(input, init)),
    );
    const grant = await remote.addStaff({ login: "remote-admin", role: "admin" });
    expect(grant).toMatchObject({ login: "remote-admin", role: "admin" });
    const { reports } = await remote.seed();
    expect(reports.length).toBeGreaterThan(0);
    expect((await remote.summary()).staff.map((member) => member.login)).toContain("remote-admin");
    await remote.advanceClock(5_000);
    expect(await remote.clockNow()).toBeGreaterThan(Date.now() + 4_000);
  });

  it("answers errors and unknown methods without crashing", async () => {
    const { world, origin } = await setup();
    const remote = remoteControl(`${origin}/control`, (input, init) =>
      world.handle(new Request(input, init)),
    );
    await expect(remote.approveDeviceCode("NOPE-NOPE", "nobody")).rejects.toThrow(/No Staff user/);
    const unknown = await world.handle(
      new Request(`${origin}/control/constructor`, { method: "POST", body: "[]" }),
    );
    expect(unknown.status).toBe(404);
    const malformed = await world.handle(
      new Request(`${origin}/control/summary`, { method: "POST", body: "{" }),
    );
    expect(malformed.status).toBe(400);
  });

  it("serves a GET summary for a browser or curl", async () => {
    const { world, origin } = await setup();
    const reply = await world.handle(new Request(`${origin}/control/summary`));
    expect((await reply.json()).result).toMatchObject({ org: "fake-org", repo: "reports" });
  });

  it("wraps the in-process control for helpers written against the async interface", async () => {
    const { control } = await setup();
    const wrapped = asAsync(control);
    const grant = await wrapped.addStaff({ login: "wrapped", role: "read" });
    expect(grant.login).toBe("wrapped");
  });

  it("answers 404 for a path outside every service", async () => {
    const { world, origin } = await setup();
    expect((await world.handle(new Request(`${origin}/nowhere`))).status).toBe(404);
  });
});
