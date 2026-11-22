import { runInDurableObject } from "cloudflare:test";
import { env, exports } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { configSchema } from "@shared/config/schema.ts";
import type { GitHubIssue } from "@shared/github/types.ts";
import { buildReporterComment } from "@shared/reports/attribution.ts";
import { referenceConfig } from "@shared/seed/reference-config.ts";
import { statusCommentItemSchema, statusViewSchema } from "@shared/status/view.ts";
import { createBotClient } from "../github/bot-client.ts";
import { reissueLink } from "../reports/reissue.ts";
import { addToAllowlist, fakeClient, fakeWorld } from "../testing/world.ts";

// The Status page's three endpoints through the real Worker, against the fake GitHub and fake Resend
// (ticket #25, SPEC 4.3, 4.5, 4.6): lookup, add-comment and Reissue.

const api = "https://reports.test/api";
let listed = "";
let addressCounter = 0;
let ipCounter = 0;
const freshIp = () => `198.51.101.${++ipCounter}`;

async function call(path: string, body: unknown, ip: string = freshIp()) {
  const response = await exports.default.fetch(`${api}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "cf-connecting-ip": ip },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json<Record<string, any>>() };
}

const lookup = (token: string, ip?: string) => call("/status/lookup", { token }, ip);
const comment = (token: string, text: string, ip?: string) =>
  call("/status/comment", { token, text }, ip);
const reissue = (token: string, ip?: string) => call("/status/reissue", { token }, ip);

async function waitForMail(to: string, count: number) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const mails = fakeWorld().control.outbox(to);
    if (mails.length >= count) return mails;
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
  throw new Error(`no mail to ${to} arrived`);
}

/** Files a Report the way a Reporter does (code, then submit) and returns what the confirmation holds. */
async function fileReport(overrides: Record<string, unknown> = {}) {
  const ip = freshIp();
  await call("/reports/code", { email: listed }, ip);
  const mails = await waitForMail(listed, 1);
  const code = /\b(\d{6})\b/.exec(mails.at(-1)?.text ?? "")?.[1] ?? "";
  const filed = await call(
    "/reports/submit",
    {
      email: listed,
      code,
      credential: crypto.randomUUID().replace(/-/g, "") + "abcdefghij",
      category: "elevator",
      location: "stairwell",
      title: "Elakadt a lift",
      description: "A lift megáll.\n```\nnem kerítés",
      place: "B lépcsőház",
      ...overrides,
    },
    ip,
  );
  expect(filed.status).toBe(200);
  const token = (filed.body["statusUrl"] as string).split("/").at(-1) as string;
  return { number: filed.body["number"] as number, token };
}

/** A Staff member's write to the fake GitHub, as the dashboard (or the GitHub UI) would make it. */
function asStaff(login = "gondnok-jozsi") {
  const { token } = fakeWorld().control.addStaff({ login, role: "triage" });
  return async (method: string, path: string, json?: unknown) => {
    const reply = await fakeClient().github(method, `/repos/fake-org/reports${path}`, {
      token,
      ...(json === undefined ? {} : { json }),
    });
    // A write the fake refused would otherwise leave a test passing for the wrong reason.
    expect(reply.status, reply.text).toBeLessThan(300);
    return reply;
  };
}

async function issueOf(number: number): Promise<GitHubIssue> {
  const bot = createBotClient(env);
  return (await bot.request<GitHubIssue>("GET", bot.repoPath(`/issues/${number}`))).data;
}

async function commentsOf(number: number) {
  const bot = createBotClient(env);
  return bot.paginate<{ body: string; user: { type: string } }>(
    bot.repoPath(`/issues/${number}/comments`),
  );
}

beforeEach(async () => {
  // Each test's world starts again at issue #1, but a Report gate's daily counts outlive the test.
  await runInDurableObject(env.REPORT_GATE.getByName("1"), (_gate, state) =>
    state.storage.deleteAll(),
  );
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

describe("POST /api/status/lookup", () => {
  it("answers the same generic 404 for an unknown or malformed token", async () => {
    const unknown = await lookup("A".repeat(22));
    expect(unknown).toEqual({ status: 404, body: { error: { code: "not_found" } } });
    expect(await lookup("not a token!")).toEqual(unknown);
    expect(await lookup("x")).toEqual(unknown);
  });

  it("projects the Report: only allowlisted fields, no email, token, marker or Priority", async () => {
    const { number, token } = await fileReport();
    const github = asStaff();
    await github("PATCH", `/issues/${number}`, {
      labels: ["category:elevator", "location:stairwell", "status:new", "priority:urgent"],
      assignees: ["gondnok-jozsi"],
    });
    await github("POST", `/issues/${number}/comments`, { body: "Holnap kijövünk." });

    const answer = await lookup(token);
    expect(answer.status).toBe(200);
    expect(() => statusViewSchema.parse(answer.body)).not.toThrow();
    expect(answer.body).toMatchObject({
      number,
      title: "Elakadt a lift",
      body: {
        kind: "report",
        place: "B lépcsőház",
        description: "A lift megáll.\n```\nnem kerítés",
      },
      state: "open",
      closeReason: null,
      status: "new",
      category: "elevator",
      location: "stairwell",
      assigned: true,
    });
    expect(answer.body["timeline"]).toContainEqual(
      expect.objectContaining({ kind: "comment", author: "staff", text: "Holnap kijövünk." }),
    );
    expect(answer.body["timeline"]).toContainEqual(expect.objectContaining({ kind: "assigned" }));
    const text = JSON.stringify(answer.body);
    for (const secret of [
      listed,
      token,
      "urgent",
      "gondnok-jozsi",
      "fault-report-attempt",
      "http",
    ]) {
      expect(text, secret).not.toContain(secret);
    }
  });

  it("shows a Reporter comment as Reporter and a Staff lookalike as Staff", async () => {
    const { number, token } = await fileReport();
    expect((await comment(token, "Még mindig áll.")).status).toBe(200);
    const lookalike = buildReporterComment("Én vagyok a bejelentő");
    await asStaff()("POST", `/issues/${number}/comments`, { body: lookalike });
    const answer = await lookup(token);
    const comments = (answer.body["timeline"] as any[]).filter((item) => item.kind === "comment");
    expect(comments).toMatchObject([
      { author: "reporter", text: "Még mindig áll." },
      { author: "staff", text: lookalike },
    ]);
  });

  it("follows every page of the timeline", async () => {
    const { number, token } = await fileReport();
    const github = asStaff();
    for (let index = 0; index < 105; index++) {
      await github("POST", `/issues/${number}/comments`, { body: `megjegyzés ${index}` });
    }
    const answer = await lookup(token);
    const comments = (answer.body["timeline"] as any[]).filter((item) => item.kind === "comment");
    expect(comments).toHaveLength(105);
  });

  it("shows a closed Report's reason and ignores a stale Status label", async () => {
    const { number, token } = await fileReport();
    await asStaff()("PATCH", `/issues/${number}`, { state: "closed", state_reason: "not_planned" });
    const answer = await lookup(token);
    expect(answer.body).toMatchObject({ state: "closed", closeReason: "rejected", status: null });
  });

  it("serves a second request from the 30 s cache, which a Reporter comment evicts", async () => {
    const { number, token } = await fileReport();
    const count = async () =>
      ((await lookup(token)).body["timeline"] as any[]).filter((item) => item.kind === "comment")
        .length;
    expect(await count()).toBe(0);
    await asStaff()("POST", `/issues/${number}/comments`, { body: "Kívülről" });
    expect(await count()).toBe(0);
    expect((await comment(token, "Belülről")).status).toBe(200);
    expect(await count()).toBe(2);
  });

  it("answers 429 after 20 requests a minute from one address, and 6 a minute for one token", async () => {
    const ip = freshIp();
    const statuses: number[] = [];
    for (let attempt = 0; attempt < 22; attempt++) {
      statuses.push((await lookup(crypto.randomUUID().replace(/-/g, "").slice(0, 22), ip)).status);
    }
    expect(statuses.slice(0, 20)).toEqual(Array(20).fill(404));
    expect(statuses.slice(20)).toEqual([429, 429]);

    const { token } = await fileReport();
    const perToken: number[] = [];
    for (let attempt = 0; attempt < 7; attempt++) perToken.push((await lookup(token)).status);
    expect(perToken).toEqual([200, 200, 200, 200, 200, 200, 429]);
  });

  it("says upstream_unavailable when GitHub cannot be read", async () => {
    const { token } = await fileReport();
    fakeWorld().control.addFault({
      service: "github",
      method: "GET",
      path: "^/repos/.+/issues/\\d+$",
      effect: { type: "status", status: 502 },
      times: null,
    });
    expect(await lookup(token)).toEqual({
      status: 502,
      body: { error: { code: "upstream_unavailable" } },
    });
  });
});

describe("POST /api/status/comment", () => {
  it("has the Bot post the marker and the canonical fence, returns an allowlisted comment, and leaks no contact data", async () => {
    const { number, token } = await fileReport();
    const text = "Nem működik.\n```\n&lt;b&gt; **Reporter:**";
    const reply = await comment(token, `  ${text}\n\n `);
    expect(reply).toEqual({
      status: 200,
      body: {
        accepted: true,
        comment: {
          kind: "comment",
          author: "reporter",
          text,
          at: expect.any(String),
        },
      },
    });
    expect(() => statusCommentItemSchema.parse(reply.body["comment"])).not.toThrow();
    const [posted] = await commentsOf(number);
    expect(posted?.user.type).toBe("Bot");
    expect(posted?.body).toBe(`**Reporter:**\n\n\`\`\`\`\n${text}\n\`\`\`\``);
    expect(posted?.body).not.toContain(listed);
    const serialized = JSON.stringify(reply.body);
    for (const secret of [listed, token, "bot", "http", "fault-report-attempt"]) {
      expect(serialized.toLowerCase(), secret).not.toContain(secret);
    }
  });

  it("answers the same 404 for an unknown token", async () => {
    expect(await comment("A".repeat(22), "hello")).toEqual({
      status: 404,
      body: { error: { code: "not_found" } },
    });
  });

  it("accepts 1 to 2,000 characters after trimming", async () => {
    const { token } = await fileReport();
    const reject = { status: 422, body: { error: { code: "comment_length" } } };
    expect(await comment(token, "   \n ")).toEqual(reject);
    expect((await comment(token, "x".repeat(2001))).status).toBe(422);
    expect((await comment(token, ` ${"y".repeat(2000)} `)).status).toBe(200);
    expect(await comment(token, "z")).toMatchObject({ status: 429 });
  });

  it("never reopens a closed Report", async () => {
    const { number, token } = await fileReport();
    await asStaff()("PATCH", `/issues/${number}`, { state: "closed", state_reason: "completed" });
    expect((await comment(token, "Újra elromlott")).status).toBe(200);
    expect((await issueOf(number)).state).toBe("closed");
  });

  it("answers 429 after 3 comments a minute for one token, and 6 a minute from one address", async () => {
    const { token } = await fileReport();
    const perToken: number[] = [];
    for (let attempt = 0; attempt < 4; attempt++) {
      perToken.push((await comment(token, `megjegyzés ${attempt}`)).status);
    }
    expect(perToken).toEqual([200, 200, 200, 429]);

    const ip = freshIp();
    const perIp: number[] = [];
    for (let attempt = 0; attempt < 8; attempt++) {
      perIp.push(
        (await comment(crypto.randomUUID().replace(/-/g, "").slice(0, 22), "x", ip)).status,
      );
    }
    expect(perIp.slice(0, 6)).toEqual(Array(6).fill(404));
    expect(perIp.slice(6)).toEqual([429, 429]);
  });
});

describe("the Report gate's daily budgets", () => {
  const T0 = Date.UTC(2026, 0, 1, 12);

  it("allows 20 comments and 3 holder Reissues a day, per Report, and starts afresh the next day", async () => {
    const gate = env.REPORT_GATE.getByName("501");
    for (let index = 0; index < 20; index++) expect(await gate.take("comment", T0)).toBe(true);
    expect(await gate.take("comment", T0)).toBe(false);
    for (let index = 0; index < 3; index++) expect(await gate.take("reissue", T0)).toBe(true);
    expect(await gate.take("reissue", T0)).toBe(false);

    expect(await gate.take("comment", T0 + 24 * 60 * 60 * 1000)).toBe(true);
    expect(await env.REPORT_GATE.getByName("502").take("comment", T0)).toBe(true);
    await runInDurableObject(gate, (_gate, state) => state.storage.deleteAll());
  });
});

describe("POST /api/status/reissue and the shared Reissue function", () => {
  it("ends the old link, mails the new one to the Reporter only, and never returns it", async () => {
    const { number, token } = await fileReport();
    await waitForMail(listed, 2);
    const answer = await reissue(token);
    expect(answer).toEqual({ status: 200, body: { sent: true } });

    const mails = await waitForMail(listed, 3);
    const mail = mails.at(-1);
    const fresh = /https:\/\/reports\.test\/status\/([A-Za-z0-9_-]{22})/.exec(
      mail?.text ?? "",
    )?.[1];
    expect(fresh).toBeTruthy();
    expect(fresh).not.toBe(token);
    expect(mail?.subject).toContain(`Bejelentés #${number}`);
    expect(mail?.to).toEqual([listed]);
    expect(JSON.stringify(answer)).not.toContain(fresh as string);

    expect(await env.KV.get(`status-token:${token}`)).toBeNull();
    expect(await env.KV.get(`status-token:${fresh}`)).toBe(String(number));
    expect(await env.KV.get(`issue-token:${number}`)).toBe(fresh);
    expect((await lookup(token)).status).toBe(404);
    expect((await lookup(fresh as string)).status).toBe(200);
  });

  it("evicts the cached view, so the old link 404s at once", async () => {
    const { token } = await fileReport();
    expect((await lookup(token)).status).toBe(200);
    expect((await reissue(token)).status).toBe(200);
    expect((await lookup(token)).status).toBe(404);
  });

  it("answers the same 404 for an unknown token, and for a link that was already replaced", async () => {
    const { token } = await fileReport();
    expect((await reissue(token)).status).toBe(200);
    expect(await reissue(token)).toEqual({ status: 404, body: { error: { code: "not_found" } } });
    expect((await reissue("A".repeat(22))).status).toBe(404);
  });

  it("caps the holder path at 3 per Report a day, each new link working", async () => {
    let { token } = await fileReport();
    for (let round = 1; round <= 3; round++) {
      expect((await reissue(token)).status).toBe(200);
      const mail = (await waitForMail(listed, 2 + round)).at(-1);
      token = /status\/([A-Za-z0-9_-]{22})/.exec(mail?.text ?? "")?.[1] as string;
    }
    expect(await reissue(token)).toEqual({
      status: 429,
      body: { error: { code: "rate_limited" } },
    });
    expect((await lookup(token)).status).toBe(200);
  });

  it("is uncapped for Staff through the same function", async () => {
    const { number } = await fileReport();
    const config = configSchema.parse(referenceConfig);
    for (let round = 0; round < 5; round++) {
      const outcome = await reissueLink(env, {
        config,
        issueNumber: number,
        appBase: "https://reports.test",
        capped: false,
      });
      expect(outcome).toBe("reissued");
    }
    expect((await waitForMail(listed, 7)).length).toBe(7);
  });

  it("changes nothing when the Reporter cannot be mailed (no address in KV)", async () => {
    const { number, token } = await fileReport();
    await env.KV.delete(`issue-email:${number}`);
    expect((await reissue(token)).status).toBe(404);
    expect(await env.KV.get(`issue-token:${number}`)).toBe(token);
  });

  it("says so when the mail cannot be sent, after the link has been replaced", async () => {
    const { number, token } = await fileReport();
    await waitForMail(listed, 2);
    fakeWorld().control.addFault({
      service: "resend",
      effect: { type: "status", status: 500 },
      times: null,
    });
    expect(await reissue(token)).toEqual({
      status: 502,
      body: { error: { code: "reissue_mail_failed" } },
    });
    expect(await env.KV.get(`status-token:${token}`)).toBeNull();
    expect(await env.KV.get(`issue-token:${number}`)).not.toBe(token);
  });
});
