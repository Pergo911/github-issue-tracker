import { describe, expect, it } from "vitest";
import { castedWorld } from "../testing/bot.ts";
import { createTestWorld, TEST_WEBHOOK_SECRET } from "../testing/world.ts";
import { signPayload } from "./webhooks.ts";

// The signed `issues` webhooks (SPEC 3.2): HMAC-SHA256, a delivery id, and switches for the failures GitHub
// is allowed to have (duplicates, no ordering), at the seam the Worker will see: a Request.

interface Received {
  headers: Headers;
  body: string;
  payload: any;
}

async function setup(respond: (received: Received) => Response = () => new Response("ok")) {
  const test = await createTestWorld();
  const received: Received[] = [];
  test.world.setWebhookTarget({
    url: "https://worker.test/api/github/webhook",
    secret: TEST_WEBHOOK_SECRET,
    deliver: async (request) => {
      const body = await request.text();
      const entry = { headers: request.headers, body, payload: JSON.parse(body) };
      received.push(entry);
      return respond(entry);
    },
  });
  const cast = await castedWorld(test);
  const create = async (body: Record<string, unknown>) =>
    (await test.client.github("POST", cast.path("/issues"), { token: cast.bot, json: body })).json;
  const patch = (number: number, json: Record<string, unknown>, token = cast.admin) =>
    test.client.github("PATCH", cast.path(`/issues/${number}`), { token, json });
  const actions = () => received.map((entry) => entry.payload.action);
  return { ...test, ...cast, received, create, patch, actions };
}

describe("signing", () => {
  it("matches GitHub's documented test vector", async () => {
    // https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries
    expect(await signPayload("It's a Secret to Everybody", "Hello, World!")).toBe(
      "sha256=757107ea0eb2509fc211221cce984b8a37570b6d7586c22c46f4379c8b043e17",
    );
  });
});

describe("delivery", () => {
  it("sends opened and one labeled per label on create, signed and with a delivery id", async () => {
    const { control, create, received, actions } = await setup();
    await create({ title: "t", labels: ["a", "b"] });
    await control.flushWebhooks();

    expect(actions()).toEqual(["opened", "labeled", "labeled"]);
    const first = received[0]!;
    expect(first.headers.get("x-github-event")).toBe("issues");
    expect(first.headers.get("x-github-delivery")).toMatch(/^[0-9a-f-]{36}$/);
    expect(first.headers.get("x-hub-signature-256")).toBe(
      await signPayload(TEST_WEBHOOK_SECRET, first.body),
    );
    expect(first.headers.get("user-agent")).toMatch(/^GitHub-Hookshot\//);
    expect(first.headers.get("content-type")).toBe("application/json");
    expect(new Set(received.map((entry) => entry.headers.get("x-github-delivery"))).size).toBe(3);
    expect(received[1]!.payload.label.name).toBe("a");
    expect(received[0]!.payload).toMatchObject({
      issue: { number: 1, title: "t", state: "open" },
      sender: { type: "Bot", login: "fault-reports-bot[bot]" },
      repository: { full_name: "fake-org/reports" },
    });
  });

  it("sends an event for every change a PATCH makes", async () => {
    const { control, create, patch, received, actions } = await setup();
    await create({ title: "t", labels: ["a"] });
    await control.flushWebhooks();
    received.length = 0;
    await patch(1, {
      title: "u",
      labels: ["b"],
      assignees: ["adam-admin"],
      state: "closed",
      state_reason: "not_planned",
    });
    await control.flushWebhooks();
    expect(actions()).toEqual(["edited", "unlabeled", "labeled", "assigned", "closed"]);
    expect(received[0]!.payload.changes).toEqual({ title: { from: "t" } });
    expect(received[3]!.payload.assignee.login).toBe("adam-admin");
    expect(received[4]!.payload.issue).toMatchObject({
      state: "closed",
      state_reason: "not_planned",
    });
    expect(received[4]!.payload.sender.login).toBe("adam-admin");
  });

  it("sends reopened, unassigned and an edited body with the old body", async () => {
    const { control, create, patch, received, actions } = await setup();
    await create({ title: "t", body: "old" });
    await patch(1, { assignees: ["adam-admin"], state: "closed" });
    await control.flushWebhooks();
    received.length = 0;
    await patch(1, { body: "new", assignees: [], state: "open" });
    await control.flushWebhooks();
    expect(actions()).toEqual(["edited", "unassigned", "reopened"]);
    expect(received[0]!.payload.changes).toEqual({ body: { from: "old" } });
  });

  it("sends nothing for a write that changes nothing, nor for a seeded Report", async () => {
    const { control, create, patch, received } = await setup();
    await create({ title: "t" });
    await control.flushWebhooks();
    received.length = 0;
    await patch(1, { title: "t", labels: [] });
    control.createReport({ title: "seeded", labels: ["x"] });
    await control.flushWebhooks();
    expect(received).toEqual([]);
  });

  it("delivers a seeded Report's events when asked to", async () => {
    const { control, actions } = await setup();
    control.createReport({ title: "seeded", labels: ["x"], webhooks: true });
    await control.flushWebhooks();
    expect(actions()).toEqual(["opened", "labeled"]);
  });

  it("sends `deleted` with the issue as it was, when a Report is deleted", async () => {
    const { control, create, received, actions } = await setup();
    await create({ title: "to erase", labels: ["a"] });
    await control.flushWebhooks();
    received.length = 0;
    control.deleteReport(1);
    await control.flushWebhooks();
    expect(actions()).toEqual(["deleted"]);
    expect(received[0]!.payload.issue).toMatchObject({ number: 1, title: "to erase" });
  });

  it("records each delivery with the status the Worker answered, and does not retry a failure", async () => {
    const { control, create } = await setup(() => new Response("boom", { status: 500 }));
    await create({ title: "t" });
    await control.flushWebhooks();
    const [delivery] = control.webhookDeliveries();
    expect(delivery).toMatchObject({
      action: "opened",
      issueNumber: 1,
      attempts: [{ status: 500 }],
    });
  });

  it("records a delivery that fails outright, and one with no target at all", async () => {
    const { control, world, create } = await setup(() => {
      throw new Error("worker unreachable");
    });
    await create({ title: "t" });
    await control.flushWebhooks();
    expect(control.webhookDeliveries()[0]!.attempts[0]).toEqual({
      status: null,
      error: "worker unreachable",
    });
    world.setWebhookTarget(null);
    await create({ title: "u" });
    await control.flushWebhooks();
    expect(control.webhookDeliveries()[1]!.attempts[0]!.error).toContain("no webhook target");
  });
});

describe("the switches for what GitHub may do", () => {
  it("delivers every webhook twice with the same delivery id when duplicates are on", async () => {
    const { control, create, received } = await setup();
    control.setWebhookDuplicates(true);
    await create({ title: "t" });
    await control.flushWebhooks();
    expect(received).toHaveLength(2);
    expect(received[0]!.headers.get("x-github-delivery")).toBe(
      received[1]!.headers.get("x-github-delivery"),
    );
    expect(received[0]!.body).toBe(received[1]!.body);
    expect(control.webhookDeliveries()[0]!.attempts).toHaveLength(2);
  });

  it("holds deliveries and releases them in reverse, to model out-of-order arrival", async () => {
    const { control, create, patch, actions } = await setup();
    control.holdWebhooks();
    await create({ title: "t", labels: ["a"] });
    await patch(1, { state: "closed" });
    await control.flushWebhooks();
    expect(actions()).toEqual([]);
    control.releaseWebhooks({ reverse: true });
    await control.flushWebhooks();
    expect(actions()).toEqual(["closed", "labeled", "opened"]);
  });

  it("releases held deliveries in order by default", async () => {
    const { control, create, actions } = await setup();
    control.holdWebhooks();
    await create({ title: "t", labels: ["a"] });
    control.releaseWebhooks();
    await control.flushWebhooks();
    expect(actions()).toEqual(["opened", "labeled"]);
  });

  it("redelivers a delivery on request with the same id and body", async () => {
    const { control, create, received } = await setup();
    await create({ title: "t" });
    await control.flushWebhooks();
    const [delivery] = control.webhookDeliveries();
    control.redeliverWebhook(delivery!.id);
    await control.flushWebhooks();
    expect(received).toHaveLength(2);
    expect(received[1]!.headers.get("x-github-delivery")).toBe(delivery!.id);
    expect(received[1]!.body).toBe(received[0]!.body);
  });
});
