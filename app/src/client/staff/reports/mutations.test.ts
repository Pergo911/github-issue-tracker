import { describe, expect, it } from "vitest";
import { castedWorld } from "@fakes/testing/bot.ts";
import { TEST_ORG, TEST_REPO } from "@fakes/testing/constants.ts";
import { createTestWorld } from "@fakes/testing/world.ts";
import { createReportWrites, DuplicateOriginalError } from "./mutations.ts";

// The Detail view's writes (SPEC 2.4, 2.6), against the fake GitHub: every one that touches labels reads the
// Report fresh, swaps only its own dimension and sends one PATCH, so another member's concurrent change survives
// and GitHub never sees a Report with two Statuses or none.

async function setup() {
  const test = await createTestWorld();
  const cast = await castedWorld(test);
  const requests: { method: string; path: string; body: unknown }[] = [];
  const writesFor = (token: string) =>
    createReportWrites({
      githubFetch: async (path, init = {}) => {
        const headers = new Headers(init.headers);
        headers.set("authorization", `Bearer ${token}`);
        headers.set("user-agent", "test");
        headers.set("x-github-api-version", "2022-11-28");
        const method = init.method ?? "GET";
        const body = typeof init.body === "string" ? (JSON.parse(init.body) as unknown) : undefined;
        requests.push({ method, path, body });
        return test.world.handle(
          new Request(`${test.origin}/github${path}`, { ...init, method, headers }),
        );
      },
    });
  const create = async (body: Record<string, unknown>) =>
    (await test.client.github("POST", cast.path("/issues"), { token: cast.bot, json: body })).json;
  const issue = async (number: number) =>
    (await test.client.github("GET", cast.path(`/issues/${number}`), { token: cast.read })).json;
  const names = async (number: number) =>
    ((await issue(number)).labels as { name: string }[]).map((label) => label.name);
  const patches = () => requests.filter((request) => request.method === "PATCH");
  return { ...test, ...cast, writesFor, create, issue, names, patches, requests };
}

const repo = { owner: TEST_ORG, name: TEST_REPO };

describe("a label write", () => {
  it("keeps another member's Priority change made between load and save", async () => {
    const { writesFor, create, names, patches, client, admin, path, triage } = await setup();
    await create({ title: "t", labels: ["category:plumbing", "priority:low", "status:new"] });
    // The page was loaded here, showing priority:low. Someone else raises it before this member saves.
    await client.github("PATCH", path("/issues/1"), {
      token: admin,
      json: { labels: ["category:plumbing", "priority:high", "status:new"] },
    });
    await writesFor(triage).setDimension(repo, 1, "status", "in-progress");
    expect(await names(1)).toEqual(
      expect.arrayContaining(["category:plumbing", "priority:high", "status:in-progress"]),
    );
    expect(await names(1)).toHaveLength(3);
    expect(patches()).toHaveLength(1);
  });

  it("repairs an invalid Status in the one PATCH of a Status change", async () => {
    const { writesFor, create, names, patches, triage } = await setup();
    await create({ title: "t", labels: ["status:new", "status:retired", "priority:low"] });
    await writesFor(triage).setDimension(repo, 1, "status", "in-progress");
    expect((await names(1)).sort()).toEqual(["priority:low", "status:in-progress"]);
    expect(patches()).toHaveLength(1);
  });

  it("never shows GitHub a Report with two Statuses or none, in the timeline's own steps", async () => {
    const { writesFor, create, client, triage, read, path } = await setup();
    await create({ title: "t", labels: ["status:new"] });
    await writesFor(triage).setDimension(repo, 1, "status", "in-progress");
    await writesFor(triage).setDimension(repo, 1, "status", "done");
    const timeline = (await client.github("GET", path("/issues/1/timeline"), { token: read }))
      .json as { event: string; created_at: string; label?: { name: string } }[];
    // Events that share a timestamp came from one write, so GitHub observed them together.
    const steps = new Map<string, typeof timeline>();
    for (const event of timeline)
      steps.set(event.created_at, [...(steps.get(event.created_at) ?? []), event]);
    const statuses = new Set<string>();
    for (const step of steps.values()) {
      for (const event of step) {
        if (!event.label?.name.startsWith("status:")) continue;
        if (event.event === "labeled") statuses.add(event.label.name);
        else statuses.delete(event.label.name);
      }
      expect(statuses.size).toBe(1);
    }
  });

  it("sets a Category, Location or Priority without touching the others", async () => {
    const { writesFor, create, names, triage } = await setup();
    await create({ title: "t", labels: ["category:plumbing", "location:roof", "status:new"] });
    await writesFor(triage).setDimension(repo, 1, "priority", "urgent");
    await writesFor(triage).setDimension(repo, 1, "category", "electrical");
    expect((await names(1)).sort()).toEqual([
      "category:electrical",
      "location:roof",
      "priority:urgent",
      "status:new",
    ]);
  });
});

describe("closing", () => {
  it("closes as fixed in one PATCH that also drops the Status label", async () => {
    const { writesFor, create, issue, patches, triage } = await setup();
    await create({ title: "t", labels: ["priority:low", "status:in-progress"] });
    await writesFor(triage).close(repo, 1, { reason: "fixed" });
    expect(await issue(1)).toMatchObject({
      state: "closed",
      state_reason: "completed",
      labels: [{ name: "priority:low" }],
    });
    expect(patches()).toHaveLength(1);
  });

  it("closes as rejected", async () => {
    const { writesFor, create, issue, triage } = await setup();
    await create({ title: "t", labels: ["status:new"] });
    await writesFor(triage).close(repo, 1, { reason: "rejected" });
    expect(await issue(1)).toMatchObject({ state: "closed", state_reason: "not_planned" });
  });

  it("closes as a duplicate of another Report, given by its number", async () => {
    const { writesFor, create, issue, triage } = await setup();
    await create({ title: "original" });
    await create({ title: "copy", labels: ["status:new"] });
    await writesFor(triage).close(repo, 2, { reason: "duplicate", duplicateOf: 1 });
    expect(await issue(2)).toMatchObject({
      state: "closed",
      state_reason: "duplicate",
      labels: [],
    });
  });

  it("refuses a duplicate of itself or of a Report that does not exist, and changes nothing", async () => {
    const { writesFor, create, issue, patches, triage } = await setup();
    await create({ title: "t", labels: ["status:new"] });
    await expect(
      writesFor(triage).close(repo, 1, { reason: "duplicate", duplicateOf: 1 }),
    ).rejects.toBeInstanceOf(DuplicateOriginalError);
    await expect(
      writesFor(triage).close(repo, 1, { reason: "duplicate", duplicateOf: 99 }),
    ).rejects.toBeInstanceOf(DuplicateOriginalError);
    expect((await issue(1)).state).toBe("open");
    expect(patches()).toHaveLength(0);
  });
});

describe("reopening", () => {
  it("applies the Initial status in the same PATCH, replacing any stale Status", async () => {
    const { writesFor, create, issue, patches, requests, triage } = await setup();
    await create({ title: "t", labels: ["priority:low", "status:retired"] });
    await writesFor(triage).close(repo, 1, { reason: "fixed" });
    requests.length = 0;
    await writesFor(triage).reopen(repo, 1, "new");
    expect(await issue(1)).toMatchObject({
      state: "open",
      labels: [{ name: "priority:low" }, { name: "status:new" }],
    });
    expect(patches()).toHaveLength(1);
  });
});

describe("assigning", () => {
  it("sets and clears the one assignee without reading labels", async () => {
    const { writesFor, create, issue, triage } = await setup();
    await create({ title: "t", labels: ["status:new"] });
    await writesFor(triage).assign(repo, 1, "tamas-triage");
    expect((await issue(1)).assignees.map((user: { login: string }) => user.login)).toEqual([
      "tamas-triage",
    ]);
    await writesFor(triage).assign(repo, 1, null);
    expect((await issue(1)).assignees).toEqual([]);
  });
});

describe("commenting", () => {
  it("posts as the signed-in member, which is all a Viewer may do", async () => {
    const { writesFor, create, client, read, path } = await setup();
    await create({ title: "t" });
    await writesFor(read).comment(repo, 1, "On it.");
    const comments = (await client.github("GET", path("/issues/1/comments"), { token: read }))
      .json as { body: string; user: { login: string } }[];
    expect(comments).toMatchObject([{ body: "On it.", user: { login: "vera-viewer" } }]);
  });
});
