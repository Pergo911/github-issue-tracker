import { runInDurableObject } from "cloudflare:test";
import { env, exports } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { signPayload } from "@fakes/github/webhooks.ts";
import { TEST_WEBHOOK_SECRET } from "@fakes/testing/constants.ts";
import { referenceConfig } from "@shared/seed/reference-config.ts";
import { createBotClient } from "../github/bot-client.ts";
import { fakeClient, fakeWorld } from "../testing/world.ts";

// The webhook receiver through the real Worker, fed by the fake GitHub's signed deliveries (ticket #26,
// SPEC 3.2, 4.2, 4.6, 5): the Major-change filter's emails, de-duplication, and the erasure on `deleted`.

const url = "https://reports.test/api/github/webhook";
const reporter = "anna.kiss@example.hu";
const token = "T".repeat(22);
const repo = "/repos/fake-org/reports";
const category = "category:elevator";

beforeEach(async () => {
  await env.KV.put("config", JSON.stringify(referenceConfig));
  fakeWorld().control.addStaff({ login: "gondnok-jozsi", role: "triage" });
});

afterEach(async () => {
  await env.KV.delete("config");
  for (const prefix of ["issue-email:", "status-token:", "issue-token:", "webhook-seen:"]) {
    for (const { name } of (await env.KV.list({ prefix })).keys) await env.KV.delete(name);
  }
});

/** A Report that exists on GitHub and holds its three mappings, as after a finished submission. */
async function filedReport(options: { mapped?: boolean } = {}): Promise<number> {
  const { number } = fakeWorld().control.createReport({
    title: "Elakadt a lift",
    labels: ["category:elevator", "status:new"],
  });
  if (options.mapped !== false) {
    await env.KV.put(`issue-email:${number}`, reporter);
    await env.KV.put(`issue-token:${number}`, token);
    await env.KV.put(`status-token:${token}`, String(number));
  }
  return number;
}

function staff() {
  const { token: bearer } = fakeWorld().control.addStaff({
    login: "gondnok-jozsi",
    role: "triage",
  });
  return async (method: string, path: string, json?: unknown) => {
    const reply = await fakeClient().github(method, `${repo}${path}`, {
      token: bearer,
      ...(json === undefined ? {} : { json }),
    });
    expect(reply.status, reply.text).toBeLessThan(300);
    return reply;
  };
}

/** Sets the Report's labels the way the dashboard does: a PATCH with the whole list. */
const withLabels = (...labels: string[]) => ({ labels: [category, ...labels] });

async function settle() {
  await fakeWorld().control.flushWebhooks();
}

const mails = () => fakeWorld().control.outbox(reporter);

async function post(body: string, headers: Record<string, string>) {
  return exports.default.fetch(url, { method: "POST", headers, body });
}

describe("the endpoint", () => {
  it("refuses a delivery whose signature is wrong or missing, and sends nothing", async () => {
    const number = await filedReport();
    const body = JSON.stringify({
      action: "reopened",
      issue: { number, state: "open", title: "x", labels: [] },
      sender: { login: "someone", id: 1, type: "User" },
    });
    const headers = { "x-github-event": "issues", "x-github-delivery": "d-1" };
    expect((await post(body, headers)).status).toBe(401);
    expect(
      (await post(body, { ...headers, "x-hub-signature-256": `sha256=${"0".repeat(64)}` })).status,
    ).toBe(401);
    const other = await signPayload("another secret", body);
    expect((await post(body, { ...headers, "x-hub-signature-256": other })).status).toBe(401);
    expect(mails()).toEqual([]);
  });

  it("accepts a correctly signed ping and any event other than issues without acting", async () => {
    const body = JSON.stringify({ zen: "Keep it logically awesome." });
    const signature = await signPayload(TEST_WEBHOOK_SECRET, body);
    for (const event of ["ping", "issue_comment", "push"]) {
      const response = await post(body, {
        "x-github-event": event,
        "x-github-delivery": `d-${event}`,
        "x-hub-signature-256": signature,
      });
      expect(response.status).toBe(202);
    }
    expect(mails()).toEqual([]);
  });
});

describe("Major changes", () => {
  it("emails a close with its reason word, the title, the Status link, reply-to and footer", async () => {
    const number = await filedReport();
    await staff()("PATCH", `/issues/${number}`, { state: "closed", state_reason: "not_planned" });
    await settle();
    const [mail] = mails();
    expect(mails()).toHaveLength(1);
    expect(mail?.subject).toBe(`Bejelentés #${number} — „Elakadt a lift” — lezárva`);
    expect(mail?.text).toContain("Indok: a bejelentéssel nem foglalkozunk");
    expect(mail?.text).toContain(`https://reports.test/status/${token}`);
    expect(mail?.text).not.toMatch(/duplicate of|ismétlődés/i);
    expect(mail?.text).toContain("Automatikus üzenet a Rózsa Társasház");
    expect(mail?.reply_to).toEqual(["gondnok@example.org"]);
    expect(mail?.html).toBeNull();
  });

  it.each([
    [{ state_reason: "completed" }, "Indok: a hibát elhárítottuk"],
    [{ state_reason: "duplicate" }, "Indok: már korábbi bejelentésben szerepel"],
    [{}, "Indok: a hibát elhárítottuk"],
  ])("words the close reason from the catalog: %j", async (reason, line) => {
    const number = await filedReport();
    await staff()("PATCH", `/issues/${number}`, { state: "closed", ...reason });
    await settle();
    expect(mails()).toHaveLength(1);
    expect(mails()[0]?.text).toContain(line);
    expect(mails()[0]?.text).not.toContain("#" + (number + 1));
  });

  it("emails a reopen, once, and not the initial Status the dashboard applies right after", async () => {
    const number = await filedReport();
    const github = staff();
    await github("PATCH", `/issues/${number}`, { state: "closed", ...withLabels() });
    await settle();
    fakeWorld().control.clearOutbox();
    await github("PATCH", `/issues/${number}`, { state: "open", ...withLabels("status:new") });
    await settle();
    expect(mails()).toHaveLength(1);
    expect(mails()[0]?.subject).toBe(`Bejelentés #${number} — „Elakadt a lift” — újranyitva`);
  });

  it("emails a notify Status entered while open, with its display name", async () => {
    const number = await filedReport();
    await staff()("PATCH", `/issues/${number}`, withLabels("status:in-progress"));
    await settle();
    expect(mails()).toHaveLength(1);
    expect(mails()[0]?.subject).toBe(
      `Bejelentés #${number} — „Elakadt a lift” — új állapot: Folyamatban`,
    );
    expect(mails()[0]?.text).toContain(`https://reports.test/status/${token}`);
  });

  it("sends two emails for two notify Statuses added at once", async () => {
    const number = await filedReport();
    await staff()("PATCH", `/issues/${number}`, withLabels("status:in-progress", "status:on-hold"));
    await settle();
    expect(mails().map((mail) => mail.subject)).toEqual([
      `Bejelentés #${number} — „Elakadt a lift” — új állapot: Folyamatban`,
      `Bejelentés #${number} — „Elakadt a lift” — új állapot: Várakozik`,
    ]);
  });

  it("sends one email for a dashboard close: the closed event, then the Status label removed", async () => {
    const number = await filedReport();
    const github = staff();
    await github("PATCH", `/issues/${number}`, withLabels("status:in-progress"));
    await settle();
    fakeWorld().control.clearOutbox();
    // One PATCH, as the dashboard sends it: the close and the Status label removed
    await github("PATCH", `/issues/${number}`, {
      state: "closed",
      state_reason: "completed",
      ...withLabels(),
    });
    await settle();
    const actions = fakeWorld()
      .control.webhookDeliveries()
      .map((delivery) => delivery.action);
    expect(actions.slice(-2).sort()).toEqual(["closed", "unlabeled"]);
    expect(mails()).toHaveLength(1);
    expect(mails()[0]?.subject).toContain("lezárva");
  });

  it("sends nothing for link-only changes", async () => {
    const number = await filedReport();
    const github = staff();
    await github("PATCH", `/issues/${number}`, withLabels("status:new", "priority:high"));
    await github("POST", `/issues/${number}/comments`, { body: "Megnézzük." });
    await github("PATCH", `/issues/${number}`, { title: "Elakadt a nagy lift", body: "Új leírás" });
    await github("PATCH", `/issues/${number}`, { assignees: ["gondnok-jozsi"] });
    await github("PATCH", `/issues/${number}`, withLabels("status:new"));
    await settle();
    expect(fakeWorld().control.webhookDeliveries().length).toBeGreaterThan(3);
    expect(mails()).toEqual([]);
  });

  it("drops a Status entered while the Report is closed", async () => {
    const number = await filedReport();
    const github = staff();
    await github("PATCH", `/issues/${number}`, { state: "closed" });
    await settle();
    fakeWorld().control.clearOutbox();
    await github("PATCH", `/issues/${number}`, withLabels("status:in-progress"));
    await settle();
    expect(mails()).toEqual([]);
  });

  it("drops the Bot's own events", async () => {
    fakeWorld().control.holdWebhooks();
    const number = await filedReport();
    // The Bot labelling its own Report with a notify Status and commenting, as at creation
    const bot = createBotClient(env);
    await bot.request("PATCH", bot.repoPath(`/issues/${number}`), {
      body: withLabels("status:in-progress"),
    });
    await bot.request("PATCH", bot.repoPath(`/issues/${number}`), { body: { state: "closed" } });
    fakeWorld().control.releaseWebhooks();
    await settle();
    expect(fakeWorld().control.webhookDeliveries().length).toBeGreaterThan(1);
    expect(mails()).toEqual([]);
  });
});

describe("de-duplication and ordering", () => {
  it("sends once when every delivery arrives twice", async () => {
    const number = await filedReport();
    fakeWorld().control.setWebhookDuplicates(true);
    await staff()("PATCH", `/issues/${number}`, { state: "closed" });
    await settle();
    expect(mails()).toHaveLength(1);
  });

  it("sends once when GitHub redelivers", async () => {
    const number = await filedReport();
    await staff()("PATCH", `/issues/${number}`, { state: "closed" });
    await settle();
    const closed = fakeWorld()
      .control.webhookDeliveries()
      .find((delivery) => delivery.action === "closed");
    fakeWorld().control.redeliverWebhook(closed?.id as string);
    await settle();
    expect(mails()).toHaveLength(1);
    expect(await env.KV.get(`webhook-seen:${closed?.id}`)).toBe("true");
  });

  it("writes webhook-seen only for Major changes", async () => {
    const number = await filedReport();
    await staff()("PATCH", `/issues/${number}`, withLabels("status:new", "priority:high"));
    await settle();
    expect((await env.KV.list({ prefix: "webhook-seen:" })).keys).toEqual([]);
  });

  it("sends each email once when deliveries arrive out of order", async () => {
    const number = await filedReport();
    const github = staff();
    fakeWorld().control.holdWebhooks();
    await github("PATCH", `/issues/${number}`, withLabels("status:in-progress"));
    await github("PATCH", `/issues/${number}`, { state: "closed" });
    await github("PATCH", `/issues/${number}`, { state: "open" });
    fakeWorld().control.releaseWebhooks({ reverse: true });
    fakeWorld().control.setWebhookDuplicates(true);
    await settle();
    const subjects = mails().map((mail) => mail.subject.split(" — ").at(-1));
    expect(subjects.sort()).toEqual(["lezárva", "új állapot: Folyamatban", "újranyitva"].sort());
  });

  it("does not replay a failed send", async () => {
    const number = await filedReport();
    fakeWorld().control.addFault({
      service: "resend",
      path: "^/emails$",
      effect: { type: "status", status: 500 },
    });
    await staff()("PATCH", `/issues/${number}`, { state: "closed" });
    await settle();
    expect(mails()).toEqual([]);
    const closed = fakeWorld()
      .control.webhookDeliveries()
      .find((delivery) => delivery.action === "closed");
    fakeWorld().control.redeliverWebhook(closed?.id as string);
    await settle();
    expect(mails()).toEqual([]);
  });

  it("logs and drops a Major change with no issue-email mapping", async () => {
    const number = await filedReport({ mapped: false });
    await staff()("PATCH", `/issues/${number}`, { state: "closed" });
    await settle();
    expect(fakeWorld().control.outbox()).toEqual([]);
  });
});

describe("deleted", () => {
  it("purges the three mappings, so the Status link answers 404", async () => {
    const number = await filedReport();
    fakeWorld().control.deleteReport(number);
    await settle();
    expect(await env.KV.get(`issue-email:${number}`)).toBeNull();
    expect(await env.KV.get(`issue-token:${number}`)).toBeNull();
    expect(await env.KV.get(`status-token:${token}`)).toBeNull();
    const lookup = await exports.default.fetch("https://reports.test/api/status/lookup", {
      method: "POST",
      headers: { "content-type": "application/json", "cf-connecting-ip": "198.51.100.77" },
      body: JSON.stringify({ token }),
    });
    expect(lookup.status).toBe(404);
    expect((await env.REPORT_GATE.getByName(String(number)).view())?.state).toBe("deleted");
    expect(mails()).toEqual([]);
  });

  it("refuses a delayed repair and a Reissue afterwards", async () => {
    const number = await filedReport();
    const gate = env.REPORT_GATE.getByName(String(number));
    await gate.register({
      issueNumber: number,
      email: reporter,
      statusToken: token,
      attempt: null,
    });
    await gate.converge();
    expect((await gate.view())?.state).toBe("final");
    fakeWorld().control.deleteReport(number);
    await settle();
    // A repair pass that was already scheduled, and a registration that arrives late
    await gate.converge();
    await gate.register({
      issueNumber: number,
      email: reporter,
      statusToken: "L".repeat(22),
      attempt: null,
    });
    await gate.converge();
    expect(await gate.replaceToken({ issueNumber: number, newToken: "R".repeat(22) })).toEqual({
      kind: "unknown",
    });
    expect((await env.KV.list({ prefix: "issue-email:" })).keys).toEqual([]);
    expect((await env.KV.list({ prefix: "status-token:" })).keys).toEqual([]);
    expect((await env.KV.list({ prefix: "issue-token:" })).keys).toEqual([]);
  });

  it("erases a Report whose gate never saw a lifecycle, and one deleted before it was registered", async () => {
    const number = await filedReport();
    await runInDurableObject(env.REPORT_GATE.getByName(String(number)), (_gate, state) =>
      state.storage.deleteAll(),
    );
    fakeWorld().control.deleteReport(number);
    await settle();
    expect(await env.KV.get(`issue-email:${number}`)).toBeNull();
    expect(await env.KV.get(`status-token:${token}`)).toBeNull();
  });
});
