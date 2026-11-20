import { describe, expect, it } from "vitest";
import { configSchema } from "../../src/shared/config/schema.ts";
import type { GitHubIssuesWebhookPayload } from "../../src/shared/github/types.ts";
import { referenceConfig } from "../../src/shared/seed/reference-config.ts";
import { classifyIssuesEvent } from "../../src/shared/webhook/major-change.ts";
import { castedWorld } from "../testing/bot.ts";
import { FIXTURE_WEBHOOK_SECRET } from "../testing/constants.ts";
import { createTestWorld, TEST_WEBHOOK_SECRET } from "../testing/world.ts";
import { signPayload } from "./webhooks.ts";

// Real `issues` webhook deliveries recorded from `reports-sandbox` (ticket #32, `npm run capture:webhooks`):
// what the receiver must cope with, and what the fake's own deliveries must look like.

interface Fixture {
  event: string;
  headers: Record<string, string>;
  payload: GitHubIssuesWebhookPayload & Record<string, any>;
}

const files = import.meta.glob<Fixture>("../testing/fixtures/github-webhooks/*.json", {
  eager: true,
  import: "default",
});
const fixtures = Object.entries(files).map(([path, fixture]) => ({
  name: path.replace(/^.*\/|\.json$/g, ""),
  ...fixture,
}));
const named = (name: string) => {
  const found = fixtures.find((fixture) => fixture.name === name);
  if (!found) throw new Error(`no fixture ${name}`);
  return found;
};

// The sandbox Bot, as its own payloads name it.
const sandboxBot = { login: "tarsashaz-demo-reports-bot[bot]", id: 354771587 };
const taxonomy = configSchema.parse(referenceConfig).taxonomy;
const classify = (name: string) => classifyIssuesEvent(named(name).payload, taxonomy, sandboxBot);

describe("the recorded deliveries", () => {
  it("are all there: every action the design reads, from the Bot and from Staff", () => {
    const actions = new Set(fixtures.map((fixture) => fixture.payload.action));
    for (const action of [
      "opened",
      "labeled",
      "unlabeled",
      "assigned",
      "unassigned",
      "edited",
      "closed",
      "reopened",
      "deleted",
    ]) {
      expect(actions, action).toContain(action);
    }
  });

  it("carry GitHub's headers: the event, a delivery GUID, a signature, the repo target type", () => {
    for (const fixture of fixtures) {
      expect(fixture.headers["x-github-event"]).toBe(fixture.event);
      expect(fixture.headers["x-github-delivery"]).toMatch(/^[0-9a-f-]{36}$/);
      expect(fixture.headers["x-hub-signature-256"]).toMatch(/^sha256=[0-9a-f]{64}$/);
      expect(fixture.headers["x-github-hook-installation-target-type"]).toBe("repository");
      expect(fixture.headers["user-agent"]).toMatch(/^GitHub-Hookshot\//);
    }
  });

  it("are signed with the fixture secret over the stored body, as the receiver verifies", async () => {
    for (const fixture of fixtures) {
      expect(fixture.headers["x-hub-signature-256"]).toBe(
        await signPayload(FIXTURE_WEBHOOK_SECRET, JSON.stringify(fixture.payload)),
      );
    }
  });

  it("name the Bot as `<slug>[bot]` with type Bot, and Staff as plain Users, in `sender`", () => {
    const byBot = fixtures.filter((fixture) => fixture.name.endsWith("by-bot"));
    expect(byBot.length).toBeGreaterThan(0);
    for (const fixture of byBot) {
      expect(fixture.payload.sender).toMatchObject({ type: "Bot", ...sandboxBot });
    }
    const byStaff = fixtures.filter((fixture) => fixture.name.endsWith("by-staff"));
    for (const fixture of byStaff) expect(fixture.payload.sender.type).toBe("User");
  });
});

describe("the Major-change filter on real payloads", () => {
  it.each([
    ["issues.opened.by-bot", { kind: "ignore", why: "bot" }],
    ["issues.labeled.status-new.by-bot", { kind: "ignore", why: "bot" }],
    ["issues.labeled.category-elevator.by-bot", { kind: "ignore", why: "bot" }],
    ["issues.reopened.by-bot", { kind: "ignore", why: "bot" }],
    ["issues.closed.not_planned.by-bot", { kind: "ignore", why: "bot" }],
    ["issues.assigned", { kind: "ignore", why: "no-major-change" }],
    ["issues.unassigned", { kind: "ignore", why: "no-major-change" }],
    ["issues.edited", { kind: "ignore", why: "no-major-change" }],
    ["issues.unlabeled.status-new.by-staff", { kind: "ignore", why: "no-major-change" }],
    ["issues.deleted", { kind: "erase" }],
    [
      "issues.labeled.status-in-progress.by-staff",
      { kind: "email", template: "statusEntered", params: { status: "Folyamatban" } },
    ],
    [
      "issues.closed.completed.by-staff",
      { kind: "email", template: "closed", params: { reason: "fixed" } },
    ],
    [
      "issues.closed.duplicate.by-staff",
      { kind: "email", template: "closed", params: { reason: "duplicate" } },
    ],
  ] as const)("%s", (name, expected) => {
    expect(classify(name)).toEqual(expected);
  });

  // GitHub renders the `issue` of a delivery when it sends it, not when the event happened. This one came from
  // an issue that was closed and reopened within a second: the `closed` delivery shows an open issue.
  it("drops a `closed` whose issue is already open again: the `reopened` delivery says what happened", () => {
    const stale = named("issues.closed.reopened.by-staff");
    expect(stale.payload.action).toBe("closed");
    expect(stale.payload.issue.state).toBe("open");
    expect(classify("issues.closed.reopened.by-staff")).toEqual({
      kind: "ignore",
      why: "stale-state",
    });
  });

  it("sends one email for a `reopened` delivery of an open issue", () => {
    expect(classify("issues.reopened.by-staff")).toEqual({
      kind: "email",
      template: "reopened",
      params: {},
    });
  });
});

describe("the fake's deliveries look like the real ones", () => {
  async function fakeDeliveries() {
    const test = await createTestWorld();
    const received: GitHubIssuesWebhookPayload[] = [];
    test.world.setWebhookTarget({
      url: "https://worker.test/api/github/webhook",
      secret: TEST_WEBHOOK_SECRET,
      deliver: async (request) => {
        received.push(JSON.parse(await request.text()));
        return new Response("ok");
      },
    });
    const cast = await castedWorld(test);
    const patch = (number: number, json: Record<string, unknown>) =>
      test.client.github("PATCH", cast.path(`/issues/${number}`), { token: cast.admin, json });
    const created = await test.client.github("POST", cast.path("/issues"), {
      token: cast.bot,
      json: { title: "Lift stuck", body: "x", labels: ["status:new"] },
    });
    const n = created.json.number as number;
    await patch(n, { labels: ["status:in-progress"] });
    await patch(n, { assignees: ["adam-admin"] });
    await patch(n, { assignees: [] });
    await patch(n, { title: "Lift stuck again" });
    await patch(n, { state: "closed", state_reason: "completed" });
    await patch(n, { state: "open" });
    const second = await test.client.github("POST", cast.path("/issues"), {
      token: cast.bot,
      json: { title: "Doomed" },
    });
    test.control.deleteReport(second.json.number);
    await test.control.flushWebhooks();
    return received;
  }

  it("carry the same top-level keys per action, and invent no key an issue, sender, label or assignee lacks", async () => {
    const fake = await fakeDeliveries();
    const seen = new Set<string>();
    for (const real of fixtures) {
      const action = real.payload.action;
      if (action === undefined || seen.has(action)) continue;
      seen.add(action);
      const mine = fake.find((payload) => payload.action === action);
      expect(mine, `the fake never sent ${action}`).toBeDefined();
      const keys = (value: object) => Object.keys(value).sort();
      expect(keys(mine as object), action).toEqual(keys(real.payload));
      const sameAction = fixtures.filter((fixture) => fixture.payload.action === action);
      for (const part of ["issue", "sender", "label", "assignee", "changes"] as const) {
        const theirs = new Set(
          sameAction.flatMap((fixture) =>
            Object.keys((fixture.payload as Record<string, any>)[part] ?? {}),
          ),
        );
        const ours = (mine as Record<string, any>)[part] ?? {};
        for (const key of Object.keys(ours)) {
          expect(theirs, `${action}.${part}.${key} is not in a real payload`).toContain(key);
        }
      }
    }
    expect(seen.size).toBeGreaterThanOrEqual(9);
  });

  it("state the same facts as the real ones: closed carries the reason, the Bot's sender is type Bot", async () => {
    const fake = await fakeDeliveries();
    const closed = fake.find((payload) => payload.action === "closed");
    expect(closed?.issue.state).toBe("closed");
    expect(closed?.issue.state_reason).toBe("completed");
    const opened = fake.find((payload) => payload.action === "opened");
    expect(opened?.sender.type).toBe("Bot");
    expect(opened?.issue.performed_via_github_app).toBeNull();
    expect(opened?.issue.user.type).toBe("Bot");
  });
});
