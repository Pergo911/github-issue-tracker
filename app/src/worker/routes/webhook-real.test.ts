import { env, exports } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { signPayload } from "@fakes/github/webhooks.ts";
import { TEST_WEBHOOK_SECRET } from "@fakes/testing/constants.ts";
import { referenceConfig } from "@shared/seed/reference-config.ts";
import assigned from "@fakes/testing/fixtures/github-webhooks/issues.assigned.json";
import closedCompleted from "@fakes/testing/fixtures/github-webhooks/issues.closed.completed.by-staff.json";
import closedDuplicate from "@fakes/testing/fixtures/github-webhooks/issues.closed.duplicate.by-staff.json";
import closedStale from "@fakes/testing/fixtures/github-webhooks/issues.closed.reopened.by-staff.json";
import deleted from "@fakes/testing/fixtures/github-webhooks/issues.deleted.json";
import edited from "@fakes/testing/fixtures/github-webhooks/issues.edited.json";
import labeledInProgress from "@fakes/testing/fixtures/github-webhooks/issues.labeled.status-in-progress.by-staff.json";
import opened from "@fakes/testing/fixtures/github-webhooks/issues.opened.by-bot.2.json";
import reopened from "@fakes/testing/fixtures/github-webhooks/issues.reopened.by-staff.json";
import { fakeWorld } from "../testing/world.ts";

// The webhook receiver fed with REAL deliveries recorded from `reports-sandbox` (ticket #32), through the real
// Worker. The recorded signatures are over the fixture secret, so each body is re-signed with the Worker's test
// secret; the bodies, headers and ids are GitHub's. The Reports in the recordings are #40 (the lift) and #41
// (the erased one). The Bot-sent recordings are covered where the Bot's identity is the sandbox's, in
// `fakes/github/webhook-fixtures.test.ts`: this Worker's fake Bot is another App.

const url = "https://reports.test/api/github/webhook";
const reporter = "anna.kiss@example.hu";
const token = "R".repeat(22);

beforeEach(async () => {
  await env.KV.put("config", JSON.stringify(referenceConfig));
  for (const number of [40, 41]) {
    await env.KV.put(`issue-email:${number}`, reporter);
    await env.KV.put(`issue-token:${number}`, token);
  }
  await env.KV.put(`status-token:${token}`, "40");
});

afterEach(async () => {
  await env.KV.delete("config");
  for (const prefix of ["issue-email:", "status-token:", "issue-token:", "webhook-seen:"]) {
    for (const { name } of (await env.KV.list({ prefix })).keys) await env.KV.delete(name);
  }
});

interface Recording {
  event: string;
  headers: Record<string, string>;
  payload: unknown;
}

/** POSTs the recording as GitHub did, re-signed for this Worker. */
async function deliver(recording: Recording) {
  const body = JSON.stringify(recording.payload);
  return exports.default.fetch(url, {
    method: "POST",
    headers: {
      "content-type": recording.headers["content-type"] ?? "application/json",
      "user-agent": recording.headers["user-agent"] ?? "",
      "x-github-event": recording.event,
      "x-github-delivery": recording.headers["x-github-delivery"] ?? "",
      "x-hub-signature-256": await signPayload(TEST_WEBHOOK_SECRET, body),
    },
    body,
  });
}

const mails = () => fakeWorld().control.outbox(reporter);

describe("real deliveries through the receiver", () => {
  it("emails a Staff close with its reason, from the recorded completed and duplicate closes", async () => {
    expect((await deliver(closedCompleted)).status).toBe(202);
    expect(mails()).toHaveLength(1);
    expect(mails()[0]?.text).toContain("Indok: a hibát elhárítottuk");
    expect(mails()[0]?.subject).toContain("#40");
    expect(mails()[0]?.subject).toContain("lezárva");

    expect((await deliver(closedDuplicate)).status).toBe(202);
    expect(mails()).toHaveLength(2);
    expect(mails()[1]?.text).toContain("Indok: már korábbi bejelentésben szerepel");
  });

  it("emails a Staff reopen and a Staff move to a notifying Status", async () => {
    expect((await deliver(reopened)).status).toBe(202);
    expect(mails()).toHaveLength(1);
    expect((await deliver(labeledInProgress)).status).toBe(202);
    expect(mails()).toHaveLength(2);
    expect(mails()[1]?.text).toContain("Folyamatban");
  });

  it("sends nothing for the creation, an assignment or an edit", async () => {
    for (const recording of [opened, assigned, edited]) {
      expect((await deliver(recording)).status).toBe(202);
    }
    expect(mails()).toEqual([]);
  });

  it("sends nothing for a `closed` delivery that GitHub rendered after the issue was reopened", async () => {
    expect(closedStale.payload.action).toBe("closed");
    expect(closedStale.payload.issue.state).toBe("open");
    expect((await deliver(closedStale)).status).toBe(202);
    expect(mails()).toEqual([]);
  });

  it("erases the Reporter mappings on the recorded `deleted` delivery", async () => {
    expect((await deliver(deleted)).status).toBe(202);
    expect(await env.KV.get("issue-email:41")).toBeNull();
    expect(await env.KV.get("issue-token:41")).toBeNull();
    expect((await env.REPORT_GATE.getByName("41").view())?.state).toBe("deleted");
    expect(mails()).toEqual([]);
  });
});
