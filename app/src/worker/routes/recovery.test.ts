import { env, exports } from "cloudflare:workers";
import { runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FaultSpec } from "@fakes/control.ts";
import type { GitHubIssue } from "@shared/github/types.ts";
import { referenceConfig } from "@shared/seed/reference-config.ts";
import { correlationMarker } from "@shared/reports/body.ts";
import { createBotClient } from "../github/bot-client.ts";
import { kvWriter } from "../gates/kv-writer.ts";
import { probe } from "../gates/probe.ts";
import { addToAllowlist, fakeWorld } from "../testing/world.ts";
import { sha256Hex } from "../util/crypto.ts";

// Recovery of interrupted and uncertain submissions (ticket #24, SPEC 4.1, 5, ADR 0005), through the real Worker
// against the fake GitHub: every scenario ends either complete with exactly one issue, or unresolved with no
// second create.

const base = "https://reports.test/api/reports";
let listed = "";
let addressCounter = 0;
let ipCounter = 0;
const freshIp = () => `198.51.101.${++ipCounter}`;

async function post(path: "code" | "submit" | "resume", body: unknown, ip: string = freshIp()) {
  const response = await exports.default.fetch(`${base}/${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "cf-connecting-ip": ip },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json<Record<string, any>>() };
}

const newCredential = () => crypto.randomUUID().replace(/-/g, "") + "abcdefghij";

function submission(credential: string, overrides: Record<string, unknown> = {}) {
  return {
    email: listed,
    code: "000000",
    credential,
    category: "elevator",
    location: "stairwell",
    title: "Elakadt a lift",
    description: "A lift megáll.",
    place: "B lépcsőház",
    ...overrides,
  };
}

async function codeFor(email: string): Promise<string> {
  const before = fakeWorld().control.outbox(email).length;
  expect((await post("code", { email })).status).toBe(200);
  for (let attempt = 0; attempt < 100; attempt++) {
    const mails = fakeWorld().control.outbox(email);
    if (mails.length > before) return /\b(\d{6})\b/.exec(mails.at(-1)?.text ?? "")?.[1] ?? "";
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
  throw new Error("no code mail arrived");
}

async function issues(): Promise<GitHubIssue[]> {
  const bot = createBotClient(env);
  return bot.paginate<GitHubIssue>(bot.repoPath("/issues"), { query: { state: "all" } });
}

const gateOf = async (email: string) => env.EMAIL_GATE.getByName(await sha256Hex(email));

/** The attempt as the Email gate holds it, read straight from its storage. */
async function attemptOf(email: string): Promise<Record<string, any> | undefined> {
  return runInDurableObject(await gateOf(email), (_gate, state) =>
    state.storage.kv.get<Record<string, any>>("attempt"),
  );
}

async function receiptCount(email: string): Promise<number> {
  return runInDurableObject(
    await gateOf(email),
    (_gate, state) => [...state.storage.kv.list({ prefix: "receipt:" })].length,
  );
}

/** Files a Report with a given create fault; resolves to the credential used. */
async function interruptedSubmit(fault: FaultSpec) {
  const world = fakeWorld();
  world.control.holdWebhooks();
  world.control.addFault(fault);
  const credential = newCredential();
  const request = submission(credential, { code: await codeFor(listed) });
  const answer = await post("submit", request);
  return { credential, request, answer };
}

const createFault = (effect: FaultSpec["effect"]): FaultSpec => ({
  service: "github" as const,
  method: "POST",
  path: "^/repos/.+/issues$",
  effect,
});

beforeEach(async () => {
  listed = `recover.${++addressCounter}@example.hu`;
  await env.KV.put("config", JSON.stringify(referenceConfig));
  await addToAllowlist(listed, "Kiss Anna, 2/4");
});

afterEach(async () => {
  vi.restoreAllMocks();
  probe.crashAt = null;
  await env.KV.delete("config");
  for (const prefix of ["allowlist:", "issue-email:", "status-token:", "issue-token:"]) {
    for (const { name } of (await env.KV.list({ prefix })).keys) await env.KV.delete(name);
  }
});

describe("POST /api/reports/resume", () => {
  it("adopts the issue whose create response was lost, finalizes it and answers with the original result", async () => {
    const { credential, answer } = await interruptedSubmit(createFault({ type: "lost-response" }));
    expect(answer).toEqual({ status: 503, body: { error: { code: "submission_pending" } } });
    expect(await issues()).toHaveLength(1);
    expect(await env.KV.get("issue-email:1")).toBeNull();

    const resumed = await post("resume", { email: listed, credential });
    expect(resumed.status).toBe(200);
    expect(resumed.body).toMatchObject({ status: "complete", number: 1, title: "Elakadt a lift" });
    expect(resumed.body["statusUrl"]).toMatch(/^https:\/\/reports\.test\/status\/[\w-]{22}$/);
    const token = String(resumed.body["statusUrl"]).split("/").at(-1);
    expect(await env.KV.get("issue-email:1")).toBe(listed);
    expect(await env.KV.get(`status-token:${token}`)).toBe("1");
    expect(await env.KV.get("issue-token:1")).toBe(token);
    expect(await issues()).toHaveLength(1);
    // The payload is dropped; only the receipt remains
    expect(await attemptOf(listed)).toBeUndefined();
    expect(await receiptCount(listed)).toBe(1);
    // Resuming again gives the same answer
    expect(await post("resume", { email: listed, credential })).toEqual(resumed);
  });

  it("answers not_found for an unknown credential or another address, and reads nothing else", async () => {
    const { credential } = await interruptedSubmit(createFault({ type: "lost-response" }));
    expect((await post("resume", { email: listed, credential: newCredential() })).status).toBe(404);
    expect((await post("resume", { email: "other@example.hu", credential })).status).toBe(404);
  });

  it("is limited to 10 a minute from one address", async () => {
    const ip = freshIp();
    const statuses: number[] = [];
    for (let index = 0; index < 12; index++) {
      statuses.push(
        (await post("resume", { email: listed, credential: newCredential() }, ip)).status,
      );
    }
    expect(statuses.slice(0, 10).every((status) => status === 404)).toBe(true);
    expect(statuses.at(-1)).toBe(429);
  });

  it("leaves the attempt unresolved when no issue carries the marker, and never creates again", async () => {
    const { credential } = await interruptedSubmit(createFault({ type: "status", status: 502 }));
    const resumed = await post("resume", { email: listed, credential });
    expect(resumed.status).toBe(200);
    expect(resumed.body).toMatchObject({
      status: "needs_help",
      reference: expect.stringMatching(/^[0-9A-F]{4}-[0-9A-F]{4}$/),
    });
    expect(await issues()).toEqual([]);
    expect(await post("resume", { email: listed, credential })).toEqual(resumed);
    expect(await issues()).toEqual([]);
  });

  it("blocks a new submission for that address with the reference, and no create", async () => {
    const { credential } = await interruptedSubmit(createFault({ type: "status", status: 502 }));
    const resumed = await post("resume", { email: listed, credential });
    const code = (await (await gateOf(listed)).issueCode(Date.now() + 120_000)) as string;
    const blocked = await post("submit", submission(newCredential(), { code }));
    expect(blocked).toEqual({
      status: 503,
      body: { error: { code: "submission_unresolved", reference: resumed.body["reference"] } },
    });
    expect(await issues()).toEqual([]);
  });

  it("leaves the attempt unresolved when several issues carry the marker", async () => {
    const { credential } = await interruptedSubmit(createFault({ type: "status", status: 502 }));
    const marker = (await attemptOf(listed))?.["marker"] as string;
    for (let index = 0; index < 2; index++) {
      fakeWorld().control.createReport({
        title: `Dupla ${index}`,
        body: correlationMarker(marker),
      });
    }
    const resumed = await post("resume", { email: listed, credential });
    expect(resumed.body["status"]).toBe("needs_help");
    expect(await issues()).toHaveLength(2);
  });

  it("adopts a single marker match even when the create itself was reported as a 5xx", async () => {
    const { credential } = await interruptedSubmit(createFault({ type: "status", status: 502 }));
    const marker = (await attemptOf(listed))?.["marker"] as string;
    fakeWorld().control.createReport({ title: "Elakadt a lift", body: correlationMarker(marker) });
    const resumed = await post("resume", { email: listed, credential });
    expect(resumed.body).toMatchObject({ status: "complete", number: 1 });
    expect(await issues()).toHaveLength(1);
  });

  it("scans every page of issues, closed ones and pull requests included", async () => {
    const { credential } = await interruptedSubmit(createFault({ type: "status", status: 502 }));
    const marker = (await attemptOf(listed))?.["marker"] as string;
    const control = fakeWorld().control;
    for (let index = 0; index < 101; index++) control.createReport({ title: `Régi ${index}` });
    control.createReport({ title: "Lezárt", body: correlationMarker(marker), state: "closed" });
    control.createReport({ title: "PR", body: correlationMarker(marker), pullRequest: true });
    const resumed = await post("resume", { email: listed, credential });
    expect(resumed.body).toMatchObject({ status: "complete", number: 102 });
  });

  it("marks a stale dispatch fence uncertain after a crash and settles it by the marker", async () => {
    const world = fakeWorld();
    world.control.holdWebhooks();
    const credential = newCredential();
    probe.crashAt = "after-create";
    const code = await codeFor(listed);
    const crashed = await post("submit", submission(credential, { code }));
    expect(crashed.status).toBe(503);
    probe.crashAt = null;
    // Pretend the Worker died with the fence still persisted: the attempt is back to `dispatching`
    await runInDurableObject(await gateOf(listed), (_gate, state) => {
      const attempt = state.storage.kv.get<Record<string, any>>("attempt")!;
      state.storage.kv.put("attempt", { ...attempt, phase: "dispatching", issueNumber: undefined });
    });
    const gate = await gateOf(listed);
    expect((await gate.recover(Date.now())).kind).toBe("saving");
    expect((await gate.recover(Date.now() + 10 * 60_000)).kind).toBe("complete");
    expect(await issues()).toHaveLength(1);
  });
});

describe("a Worker that stops between every pair of phases", () => {
  const points = [
    "after-fence",
    "after-create",
    "after-record-issue",
    "after-register",
    "after-kv-issue-email",
    "after-kv-status-token",
    "after-kv-issue-token",
    "before-complete",
  ] as const;

  for (const point of points) {
    it(`ends complete with one issue, or unresolved with none, after stopping at ${point}`, async () => {
      fakeWorld().control.holdWebhooks();
      const credential = newCredential();
      const code = await codeFor(listed);
      probe.crashAt = point;
      const first = await post("submit", submission(credential, { code }));
      probe.crashAt = null;
      expect([200, 500, 503]).toContain(first.status);
      // The Worker "died": the fence, if persisted, is old by the time the Reporter's tab asks again.
      await runInDurableObject(await gateOf(listed), (_gate, state) => {
        const attempt = state.storage.kv.get<Record<string, any>>("attempt");
        if (attempt) state.storage.kv.put("attempt", { ...attempt, fenceAt: 0, dueAt: 0 });
      });

      const resumed = await post("resume", { email: listed, credential });
      const count = (await issues()).length;
      if (resumed.body["status"] === "complete") {
        expect(count).toBe(1);
        expect(await env.KV.get("issue-email:1")).toBe(listed);
        const token = String(resumed.body["statusUrl"]).split("/").at(-1);
        expect(await env.KV.get("issue-token:1")).toBe(token);
        expect(await env.KV.get(`status-token:${token}`)).toBe("1");
      } else {
        expect(resumed.body["status"]).toBe("needs_help");
        expect(count).toBe(0);
        expect(point).toBe("after-fence");
      }
      expect(count).toBeLessThanOrEqual(1);
    });
  }
});

describe("repairing a known issue", () => {
  it("retries failed KV writes with the fixed values until all three are in", async () => {
    fakeWorld().control.holdWebhooks();
    let failures = 2;
    const real = kvWriter.put;
    vi.spyOn(kvWriter, "put").mockImplementation(async (kvEnv, key, value) => {
      if (failures > 0) {
        failures--;
        throw new Error("KV is down");
      }
      return real(kvEnv, key, value);
    });
    const credential = newCredential();
    const request = submission(credential, { code: await codeFor(listed) });
    expect((await post("submit", request)).status).toBe(503);
    expect(await attemptOf(listed)).toMatchObject({ phase: "created", issueNumber: 1 });
    // The user, or the alarm, tries again
    let resumed = await post("resume", { email: listed, credential });
    if (resumed.body["status"] !== "complete")
      resumed = await post("resume", { email: listed, credential });
    expect(resumed.body).toMatchObject({ status: "complete", number: 1 });
    expect(await issues()).toHaveLength(1);
  });

  it("re-arms an alarm after a failure, so the repair continues without the Reporter", async () => {
    fakeWorld().control.holdWebhooks();
    let failures = 1;
    const real = kvWriter.put;
    vi.spyOn(kvWriter, "put").mockImplementation(async (kvEnv, key, value) => {
      if (failures-- > 0) throw new Error("KV is down");
      return real(kvEnv, key, value);
    });
    const request = submission(newCredential(), { code: await codeFor(listed) });
    expect((await post("submit", request)).status).toBe(503);
    const reportGate = env.REPORT_GATE.getByName("1");
    expect(
      await runInDurableObject(reportGate, (_gate, state) => state.storage.getAlarm()),
    ).not.toBeNull();
    expect(await runDurableObjectAlarm(reportGate)).toBe(true);
    expect(await env.KV.get("issue-email:1")).toBe(listed);
    expect(await attemptOf(listed)).toBeUndefined();
    expect(await receiptCount(listed)).toBe(1);
  });

  it("does not write mappings for an issue that was deleted before the retry", async () => {
    const world = fakeWorld();
    world.control.holdWebhooks();
    let fail = true;
    const real = kvWriter.put;
    vi.spyOn(kvWriter, "put").mockImplementation(async (kvEnv, key, value) => {
      if (fail) throw new Error("KV is down");
      return real(kvEnv, key, value);
    });
    const credential = newCredential();
    expect(
      (await post("submit", submission(credential, { code: await codeFor(listed) }))).status,
    ).toBe(503);
    fail = false;
    world.control.deleteReport(1);
    await post("resume", { email: listed, credential });
    expect(await env.KV.get("issue-email:1")).toBeNull();
    expect(await env.KV.get("issue-token:1")).toBeNull();
    const view = await env.REPORT_GATE.getByName("1").view();
    expect(view?.state).toBe("deleted");
  });

  it("keeps a Reissue's token when it races the repair, and its receipt never reveals the old one", async () => {
    fakeWorld().control.holdWebhooks();
    const real = kvWriter.put;
    let reissued = false;
    vi.spyOn(kvWriter, "put").mockImplementation(async (kvEnv, key, value) => {
      if (!reissued && key === "issue-email:1") {
        reissued = true;
        // From inside the gate's own context, as a Reissue arriving between two writes would be
        await kvEnv.REPORT_GATE.getByName("1").reissue("N".repeat(22));
      }
      return real(kvEnv, key, value);
    });
    const credential = newCredential();
    const request = submission(credential, { code: await codeFor(listed) });
    await post("submit", request);
    await post("resume", { email: listed, credential });
    expect(await env.KV.get("issue-token:1")).toBe("N".repeat(22));
    expect(await env.KV.get(`status-token:${"N".repeat(22)}`)).toBe("1");
    // The receipt carries the current token, never the one the Reissue replaced
    const resumed = await post("resume", { email: listed, credential });
    expect(resumed.body["statusUrl"]).toBe(`https://reports.test/status/${"N".repeat(22)}`);
    const stale = (await env.KV.list({ prefix: "status-token:" })).keys.map((key) => key.name);
    expect(stale).toEqual([`status-token:${"N".repeat(22)}`]);
    // A later Reissue voids the receipt: it reveals nothing
    await env.REPORT_GATE.getByName("1").reissue("M".repeat(22));
    expect((await post("resume", { email: listed, credential })).status).toBe(404);
    expect((await post("submit", request)).status).toBe(404);
  });

  it("does not let a repair in flight resurrect mappings an Erasure removed", async () => {
    fakeWorld().control.holdWebhooks();
    const reportGate = env.REPORT_GATE.getByName("1");
    const real = kvWriter.put;
    let erased = false;
    vi.spyOn(kvWriter, "put").mockImplementation(async (kvEnv, key, value) => {
      const result = await real(kvEnv, key, value);
      if (!erased && key === "issue-email:1") {
        erased = true;
        await kvEnv.REPORT_GATE.getByName("1").tombstone();
      }
      return result;
    });
    const credential = newCredential();
    await post("submit", submission(credential, { code: await codeFor(listed) }));
    await post("resume", { email: listed, credential });
    expect(await env.KV.get("issue-email:1")).toBeNull();
    expect(await env.KV.get("issue-token:1")).toBeNull();
    expect((await reportGate.view())?.state).toBe("deleted");
  });
});

describe("receipts", () => {
  it("keeps a valid receipt when another attempt completes, and drops it after 24 hours", async () => {
    fakeWorld().control.holdWebhooks();
    const firstCredential = newCredential();
    const first = submission(firstCredential, { code: await codeFor(listed) });
    const filed = await post("submit", first);
    expect(filed.status).toBe(200);
    // A second attempt for the same address
    const gate = await gateOf(listed);
    const code = (await gate.issueCode(Date.now() + 120_000)) as string;
    const second = await post("submit", submission(newCredential(), { code, title: "Másik hiba" }));
    expect(second.status).toBe(200);
    expect(await receiptCount(listed)).toBe(2);
    expect(await post("submit", first)).toEqual(filed);

    await runInDurableObject(gate, (_gate, state) => {
      for (const [key, value] of state.storage.kv.list<Record<string, any>>({
        prefix: "receipt:",
      })) {
        state.storage.kv.put(key, { ...value, expiresAt: Date.now() - 1 });
      }
    });
    await runDurableObjectAlarm(gate);
    expect(await receiptCount(listed)).toBe(0);
  });
});
