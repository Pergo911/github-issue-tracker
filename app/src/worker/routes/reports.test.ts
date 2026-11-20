import { env, exports } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { GitHubIssue } from "@shared/github/types.ts";
import { referenceConfig } from "@shared/seed/reference-config.ts";
import { createBotClient } from "../github/bot-client.ts";
import { addToAllowlist, fakeWorld } from "../testing/world.ts";
import { sha256Hex } from "../util/crypto.ts";

// The Submission form's two endpoints through the real Worker, against the fake GitHub and fake Resend
// (ticket #23, SPEC 4.1, 4.3, 4.5, 4.6).

const base = "https://reports.test/api/reports";
// Each test gets its own listed address: an address's gate keeps its cooldown across tests.
let listed = "";
let addressCounter = 0;
let ipCounter = 0;
const freshIp = () => `198.51.100.${++ipCounter}`;

async function post(path: "code" | "submit", body: unknown, ip: string = freshIp()) {
  const response = await exports.default.fetch(`${base}/${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "cf-connecting-ip": ip },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json<Record<string, any>>() };
}

const credential = () => crypto.randomUUID().replace(/-/g, "") + "abcdefghij";

function submission(overrides: Record<string, unknown> = {}) {
  return {
    email: listed,
    code: "000000",
    credential: credential(),
    category: "elevator",
    location: "stairwell",
    title: "Elakadt a lift",
    description: "A lift a 2. és 3. emelet között megáll.\n```\nnem kerítés",
    place: "B lépcsőház",
    ...overrides,
  };
}

async function waitForMail(to: string, count = 1) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const mails = fakeWorld().control.outbox(to);
    if (mails.length >= count) return mails;
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
  throw new Error(`no mail to ${to} arrived`);
}

/** Requests a code the way the form does and reads it from the fake outbox, like a Reporter would. */
async function codeFor(email: string, ip?: string): Promise<string> {
  const before = fakeWorld().control.outbox(email).length;
  expect((await post("code", { email }, ip)).status).toBe(200);
  const mails = await waitForMail(email, before + 1);
  return /\b(\d{6})\b/.exec(mails.at(-1)?.text ?? "")?.[1] ?? "";
}

async function issues(): Promise<GitHubIssue[]> {
  const bot = createBotClient(env);
  return bot.paginate<GitHubIssue>(bot.repoPath("/issues"), { query: { state: "all" } });
}

beforeEach(async () => {
  listed = `anna.kiss${++addressCounter}@example.hu`;
  await env.KV.put("config", JSON.stringify(referenceConfig));
  await addToAllowlist(listed, "Kiss Anna, 2/4");
});

afterEach(async () => {
  await env.KV.delete("config");
  for (const prefix of ["allowlist:", "issue-email:", "status-token:", "issue-token:"]) {
    for (const { name } of (await env.KV.list({ prefix })).keys) await env.KV.delete(name);
  }
});

describe("POST /api/reports/code", () => {
  it("answers the same body for an unlisted address, a sent code, a cooldown", async () => {
    const unlisted = await post("code", { email: "stranger@example.hu" });
    const sent = await post("code", { email: listed });
    const cooling = await post("code", { email: listed });
    expect(sent).toEqual({ status: 200, body: { accepted: true } });
    expect(unlisted).toEqual(sent);
    expect(cooling).toEqual(sent);
  });

  it("answers the same body when the per-email cap is reached", async () => {
    // Fill the hourly cap of the address directly in its gate, so the next HTTP request is a capped one.
    const gate = env.EMAIL_GATE.getByName(await sha256Hex(listed));
    for (let index = 0; index < 5; index++)
      await gate.issueCode(Date.now() - 50 * 60_000 + index * 61_000);
    const capped = await post("code", { email: listed });
    const unlisted = await post("code", { email: "stranger@example.hu" });
    expect(capped).toEqual(unlisted);
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(fakeWorld().control.outbox(listed)).toEqual([]);
  });

  it("sends the OTP email from the configured sender to a listed address only", async () => {
    await post("code", { email: "Stranger@Example.hu " });
    await post("code", { email: ` ${listed.toUpperCase()}` });
    const [mail] = await waitForMail(listed);
    expect(mail).toMatchObject({
      from: "Rózsa Társasház <reports@mail.test>",
      to: [listed],
      reply_to: ["gondnok@example.org"],
      subject: "Ellenőrző kód a hibabejelentéshez",
      html: null,
    });
    expect(mail?.text).toMatch(/Az ellenőrző kódja: \d{6}/);
    expect(fakeWorld().control.outbox("stranger@example.hu")).toEqual([]);
  });

  it("does the per-email work after the response: it answers while the send is still held", async () => {
    fakeWorld().control.addFault({
      service: "resend",
      effect: { type: "timeout", holdMs: 5_000 },
    });
    const started = Date.now();
    const answer = await post("code", { email: listed });
    expect(answer.status).toBe(200);
    expect(Date.now() - started).toBeLessThan(4_000);
    expect(fakeWorld().control.outbox(listed)).toEqual([]);
  });

  it("answers 429 from the Deployment-wide budget whatever the address, before any per-email state", async () => {
    await env.KV.put("config", JSON.stringify({ ...referenceConfig, dailyCodeBudget: 2 }));
    expect((await post("code", { email: "a@example.hu" })).status).toBe(200);
    expect((await post("code", { email: "b@example.hu" })).status).toBe(200);
    const unlisted = await post("code", { email: "c@example.hu" });
    const member = await post("code", { email: listed });
    expect(unlisted).toEqual({ status: 429, body: { error: { code: "rate_limited" } } });
    expect(member).toEqual(unlisted);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(fakeWorld().control.outbox(listed)).toEqual([]);
  });

  it("answers 429 after five requests a minute from one address without burning the daily budget", async () => {
    await env.KV.put("config", JSON.stringify({ ...referenceConfig, dailyCodeBudget: 6 }));
    const ip = freshIp();
    const statuses: number[] = [];
    for (let attempt = 0; attempt < 7; attempt++) {
      statuses.push((await post("code", { email: "x@example.hu" }, ip)).status);
    }
    const allowed = statuses.filter((status) => status === 200).length;
    expect(allowed).toBeLessThanOrEqual(5);
    expect(statuses.at(-1)).toBe(429);
    // The 429s from the noisy IP did not consume the remaining Deployment budget for another IP.
    expect((await post("code", { email: "other@example.hu" }, freshIp())).status).toBe(200);
  });

  it("says not_configured while the Deployment has no configuration, and rejects a malformed email", async () => {
    expect((await post("code", { email: "not an email" })).status).toBe(400);
    await env.KV.delete("config");
    expect(await post("code", { email: listed })).toEqual({
      status: 404,
      body: { error: { code: "not_configured" } },
    });
  });
});

describe("the Email gate", () => {
  const T0 = Date.UTC(2026, 0, 1, 12);
  const gateFor = async (name: string) => env.EMAIL_GATE.getByName(await sha256Hex(name));

  it("holds a 60 second cooldown, 5 codes an hour and 10 a day, silently", async () => {
    const gate = await gateFor("caps@example.hu");
    expect(await gate.issueCode(T0)).toMatch(/^\d{6}$/);
    expect(await gate.issueCode(T0 + 59_000)).toBeNull();
    expect(await gate.issueCode(T0 + 60_000)).toMatch(/^\d{6}$/);
    for (const minute of [2, 3, 4]) {
      expect(await gate.issueCode(T0 + minute * 60_000)).toMatch(/^\d{6}$/);
    }
    // Five in the last hour: the sixth waits
    expect(await gate.issueCode(T0 + 5 * 60_000)).toBeNull();
    expect(await gate.issueCode(T0 + 61 * 60_000 + 1)).toMatch(/^\d{6}$/);
    // Then up to ten in the day
    let issued = 6;
    for (let hour = 2; hour < 24; hour++) {
      if ((await gate.issueCode(T0 + (hour * 61 * 60_000) / 2)) !== null) issued++;
    }
    expect(issued).toBe(10);
  });

  it("burns a code after five wrong guesses, even when the sixth is right", async () => {
    const gate = await gateFor("burn@example.hu");
    const code = (await gate.issueCode(T0)) as string;
    const wrong = code === "123456" ? "654321" : "123456";
    const attempt = (guess: string, credentialHash: string) =>
      gate.verifyAndSubmit({
        code: guess,
        credentialHash,
        fingerprint: "f",
        email: "burn@example.hu",
        fields: { category: "a", location: "b", title: "abc", description: "d" },
        marker: "m",
        statusToken: "t",
        now: T0 + 1000,
      });
    for (let guess = 0; guess < 5; guess++) {
      expect((await attempt(wrong, `c${guess}`)).kind).toBe("invalid_code");
    }
    expect((await attempt(code, "c-final")).kind).toBe("invalid_code");
    // The right code on the fifth guess still works
    const second = (await gate.issueCode(T0 + 120_000)) as string;
    for (let guess = 0; guess < 4; guess++) await attempt(wrong, `d${guess}`);
    expect((await attempt(second, "d-final")).kind).toBe("verified");
  });

  it("makes an expired code, a spent code and no code indistinguishable from a wrong one", async () => {
    const gate = await gateFor("expiry@example.hu");
    const input = (code: string, credentialHash: string, now: number) => ({
      code,
      credentialHash,
      fingerprint: "f",
      email: "expiry@example.hu",
      fields: { category: "a", location: "b", title: "abc", description: "d" },
      marker: "m",
      statusToken: "t",
      now,
    });
    expect(await gate.verifyAndSubmit(input("111111", "x1", T0))).toEqual({ kind: "invalid_code" });
    const code = (await gate.issueCode(T0)) as string;
    expect(await gate.verifyAndSubmit(input(code, "x2", T0 + 10 * 60_000 + 1))).toEqual({
      kind: "invalid_code",
    });
  });
});

describe("POST /api/reports/submit", () => {
  it("files the Report: labels, the exact body, the mappings, the confirmation email", async () => {
    const code = await codeFor(listed);
    const request = submission({ code });
    const answer = await post("submit", request);
    expect(answer.status).toBe(200);
    expect(answer.body).toMatchObject({ number: 1, title: "Elakadt a lift" });
    const statusUrl = answer.body["statusUrl"] as string;
    expect(statusUrl).toMatch(/^https:\/\/reports\.test\/status\/[A-Za-z0-9_-]{22}$/);
    const token = statusUrl.split("/").at(-1) as string;

    const [issue] = await issues();
    expect(issue).toMatchObject({ number: 1, title: "Elakadt a lift", state: "open" });
    expect(issue?.user).toMatchObject({ type: "Bot" });
    expect(issue?.labels.map((label) => label.name).sort()).toEqual([
      "category:elevator",
      "location:stairwell",
      "status:new",
    ]);
    expect(issue?.body).toMatch(
      new RegExp(
        [
          "^\\*\\*Kategória:\\*\\* Lift\\n",
          "\\*\\*Helyszín:\\*\\* Lépcsőház\\n\\n",
          "\\*\\*Pontos hely:\\*\\*\\n```\\nB lépcsőház\\n```\\n\\n",
          "\\*\\*Leírás:\\*\\*\\n````\\nA lift a 2\\. és 3\\. emelet között megáll\\.\\n```\\nnem kerítés\\n````\\n\\n",
          "<!-- fault-report-attempt: [A-Za-z0-9_-]{22} -->$",
        ].join(""),
      ),
    );
    // Neither the email, the credential nor the Status token is in GitHub
    expect(issue?.body).not.toContain(listed);
    expect(issue?.body).not.toContain(token);
    expect(issue?.body).not.toContain(request.credential);

    expect(await env.KV.get("issue-email:1")).toBe(listed);
    expect(await env.KV.get(`status-token:${token}`)).toBe("1");
    expect(await env.KV.get("issue-token:1")).toBe(token);

    const confirmations = fakeWorld()
      .control.outbox(listed)
      .filter((mail) => mail.subject.startsWith("Bejelentés #1"));
    expect(confirmations).toHaveLength(1);
    expect(confirmations[0]?.subject).toBe("Bejelentés #1 — „Elakadt a lift” — beérkezett");
    expect(confirmations[0]?.text).toContain(statusUrl);
    expect(confirmations[0]?.reply_to).toEqual(["gondnok@example.org"]);
  });

  it("validates before the code is consumed, with a code per problem", async () => {
    const code = await codeFor(listed);
    for (const [overrides, expected] of [
      [{ title: "Fix `this`" }, "title_characters"],
      [{ title: "ab" }, "title_length"],
      [{ description: "  " }, "description_length"],
      [{ place: "x".repeat(101) }, "place_length"],
      [{ category: "nope" }, "unknown_category"],
      [{ location: "nope" }, "unknown_location"],
    ] as const) {
      const answer = await post("submit", submission({ code, ...overrides }));
      expect(answer, JSON.stringify(overrides)).toEqual({
        status: 422,
        body: { error: { code: expected } },
      });
    }
    expect(await issues()).toEqual([]);
    // The code was not spent by the rejected attempts
    expect((await post("submit", submission({ code }))).status).toBe(200);
  });

  it("answers a wrong, unissued or reused code with the same invalid_code", async () => {
    const code = await codeFor(listed);
    const wrong = code === "000000" ? "000001" : "000000";
    const failures = [
      await post("submit", submission({ code: wrong })),
      await post("submit", submission({ email: "stranger@example.hu", code })),
    ];
    for (const failure of failures) {
      expect(failure).toEqual({ status: 422, body: { error: { code: "invalid_code" } } });
    }
    expect((await post("submit", submission({ code }))).status).toBe(200);
    const reused = await post("submit", submission({ code }));
    expect(reused).toEqual({ status: 422, body: { error: { code: "invalid_code" } } });
  });

  it("burns the code after five wrong guesses through the endpoint", async () => {
    const code = await codeFor(listed);
    const wrong = code === "000000" ? "000001" : "000000";
    for (let guess = 0; guess < 5; guess++) {
      expect((await post("submit", submission({ code: wrong }))).body).toEqual({
        error: { code: "invalid_code" },
      });
    }
    expect((await post("submit", submission({ code }))).body).toEqual({
      error: { code: "invalid_code" },
    });
    expect(await issues()).toEqual([]);
  });

  it("replays a completed attempt from its receipt instead of creating another Report", async () => {
    const code = await codeFor(listed);
    const request = submission({ code });
    const first = await post("submit", request);
    const again = await post("submit", request);
    expect(again).toEqual(first);
    expect(await issues()).toHaveLength(1);
    // A different payload cannot reuse the credential
    const changed = await post("submit", { ...request, title: "Másik cím" });
    expect(changed.status).toBe(400);
    expect(await issues()).toHaveLength(1);
  });

  it("leaves an attempt pending when the create fails after the fence, and never creates again", async () => {
    const world = fakeWorld();
    world.control.addFault({
      service: "github",
      method: "POST",
      path: "^/repos/.+/issues$",
      effect: { type: "status", status: 502 },
    });
    const code = await codeFor(listed);
    const request = submission({ code });
    const failed = await post("submit", request);
    expect(failed).toEqual({ status: 503, body: { error: { code: "submission_pending" } } });
    expect(await issues()).toEqual([]);

    // Retrying the same attempt, or starting another with a fresh code: no second create, ever
    const retry = await post("submit", request);
    expect(retry.status).toBe(503);
    // A fresh code, as if the cooldown had passed (the gate takes its clock from the caller)
    const second = (await env.EMAIL_GATE.getByName(await sha256Hex(listed)).issueCode(
      Date.now() + 120_000,
    )) as string;
    expect(await post("submit", submission({ code: second }))).toEqual({
      status: 503,
      body: { error: { code: "submission_pending" } },
    });
    expect(await issues()).toEqual([]);
    expect(world.control.summary().faults).toBe(0);
  });

  it("does not create a second issue when the first create succeeded but its response was lost", async () => {
    const world = fakeWorld();
    // The webhooks of this issue are not what is under test: hold them (a delivery started from a dropped
    // connection's request context would never be answered, and the shared teardown would wait for it).
    world.control.holdWebhooks();
    world.control.addFault({
      service: "github",
      method: "POST",
      path: "^/repos/.+/issues$",
      effect: { type: "lost-response" },
    });
    const code = await codeFor(listed);
    const request = submission({ code });
    expect((await post("submit", request)).status).toBe(503);
    expect((await post("submit", request)).status).toBe(503);
    expect(await issues()).toHaveLength(1);
    // No mapping was written: the attempt is not complete
    expect(await env.KV.get("issue-email:1")).toBeNull();
  });

  it("completes even when the confirmation email cannot be sent", async () => {
    const code = await codeFor(listed);
    fakeWorld().control.addFault({
      service: "resend",
      effect: { type: "status", status: 500 },
      times: null,
    });
    const answer = await post("submit", submission({ code }));
    expect(answer.status).toBe(200);
    expect(await env.KV.get("issue-email:1")).toBe(listed);
  });

  it("answers 429 after ten submissions a minute from one address", async () => {
    const ip = freshIp();
    const statuses: number[] = [];
    for (let attempt = 0; attempt < 12; attempt++) {
      statuses.push((await post("submit", submission({ code: "000000" }), ip)).status);
    }
    expect(statuses.at(-1)).toBe(429);
  });
});
