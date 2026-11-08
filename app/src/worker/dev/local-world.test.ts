import { env, exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { app } from "../app.ts";
import { fakeWorld } from "../testing/world.ts";

// The demo of ticket #22, as a test: the Bot creates and reads an issue in the fake GitHub, a Staff token
// resolves to its role, and a test email lands in the fake outbox. The routes exist only in the local world.

const local = { ...env, LOCAL_WORLD: "1" };
const call = (path: string, init: RequestInit = {}, bindings: Env = local) =>
  app.fetch(new Request(`https://reports.test${path}`, init), bindings);

describe("the local world's smoke routes", () => {
  it("are absent in production: without LOCAL_WORLD they do not exist", async () => {
    const response = await exports.default.fetch("https://reports.test/api/_dev/smoke", {
      method: "POST",
      body: "{}",
    });
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: { code: "not_found" } });
    expect((await call("/api/_dev/whoami", {}, env)).status).toBe(404);
  });

  it("have the Bot create an issue and read it back, and send a test email", async () => {
    const response = await call("/api/_dev/smoke", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ to: "resident@example.hu" }),
    });
    expect(response.status).toBe(200);
    const result = await response.json<Record<string, unknown>>();
    expect(result).toMatchObject({
      issueNumber: 1,
      issueTitle: "Local world smoke test",
      author: "fault-reports-bot[bot]",
      authorType: "Bot",
    });
    const mail = fakeWorld().control.latestMailTo("resident@example.hu");
    expect(mail?.id).toBe(result["mailId"]);
    expect(fakeWorld().control.summary().issues).toBe(1);
  });

  it("resolve a Staff token to its role, and refuse anyone else", async () => {
    const { control } = fakeWorld();
    const { token } = control.addStaff({ login: "mate-maintenance", role: "triage" });
    const ok = await call("/api/_dev/whoami", { headers: { authorization: `Bearer ${token}` } });
    expect(await ok.json()).toEqual({ role: "maintenance", login: "mate-maintenance" });
    expect((await call("/api/_dev/whoami")).status).toBe(401);
    const outsider = control.addStaff({ login: "nora", role: "none" }).token;
    expect(
      (await call("/api/_dev/whoami", { headers: { authorization: `Bearer ${outsider}` } })).status,
    ).toBe(403);
  });
});
