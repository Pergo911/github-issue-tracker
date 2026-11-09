import { env, exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { addToAllowlist, fakeWorld } from "../testing/world.ts";

// The Allowlist endpoints (SPEC 5), through the real Worker against the fake GitHub: System admin only, the
// address trimmed and lowercased and nothing more, the note kept in KV and nowhere else.

const send = (method: string, path: string, token: string | undefined, body?: unknown) =>
  exports.default.fetch(`https://reports.test${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

function admin() {
  return fakeWorld().control.addStaff({ login: "ada-admin", role: "admin" }).token;
}
const stored = (email: string) => env.KV.get<Record<string, unknown>>(`allowlist:${email}`, "json");

describe("who may use the Allowlist endpoints", () => {
  it("refuses a caller without a token, and Triage and Read members, on every endpoint", async () => {
    const maintenance = fakeWorld().control.addStaff({ login: "mate", role: "triage" }).token;
    const viewer = fakeWorld().control.addStaff({ login: "vera", role: "read" }).token;
    const requests: [string, string, unknown?][] = [
      ["GET", "/api/staff/allowlist"],
      ["POST", "/api/staff/allowlist", { email: "a@example.hu" }],
      ["PUT", "/api/staff/allowlist", { email: "a@example.hu", note: "x" }],
      ["DELETE", "/api/staff/allowlist?email=a%40example.hu"],
      ["POST", "/api/staff/allowlist/bulk", { text: "a@example.hu" }],
    ];
    for (const [method, path, body] of requests) {
      expect((await send(method, path, undefined, body)).status, `${method} ${path}`).toBe(401);
      expect((await send(method, path, maintenance, body)).status, `${method} ${path}`).toBe(403);
      expect((await send(method, path, viewer, body)).status, `${method} ${path}`).toBe(403);
    }
    expect(await stored("a@example.hu")).toBeNull();
  });
});

describe("add one", () => {
  it("stores the trimmed, lowercased address with the note, who added it and when", async () => {
    const token = admin();
    const response = await send("POST", "/api/staff/allowlist", token, {
      email: "  Anna.Kiss+Lift@Example.HU ",
      note: " Kiss Anna, 2/5 ",
    });
    expect(response.status).toBe(200);
    const { entry } = await response.json<{ entry: Record<string, string> }>();
    expect(entry).toMatchObject({
      email: "anna.kiss+lift@example.hu",
      note: "Kiss Anna, 2/5",
      addedBy: "ada-admin",
    });
    expect(Date.parse(entry["addedAt"] as string)).not.toBeNaN();
    expect(await stored("anna.kiss+lift@example.hu")).toEqual({
      note: "Kiss Anna, 2/5",
      addedBy: "ada-admin",
      addedAt: entry["addedAt"],
    });
  });

  it("refuses text that is not an address, and an address already listed", async () => {
    const token = admin();
    const bad = await send("POST", "/api/staff/allowlist", token, { email: "not an address" });
    expect(bad.status).toBe(422);
    expect(await bad.json()).toEqual({ error: { code: "invalid_email" } });

    await addToAllowlist("dup@example.hu", "original");
    const dup = await send("POST", "/api/staff/allowlist", token, { email: "DUP@example.hu" });
    expect(dup.status).toBe(409);
    expect(await dup.json()).toEqual({ error: { code: "already_listed" } });
    expect((await stored("dup@example.hu"))?.["note"]).toBe("original");
  });

  it("refuses a note over 200 characters", async () => {
    const response = await send("POST", "/api/staff/allowlist", admin(), {
      email: "long@example.hu",
      note: "x".repeat(201),
    });
    expect(response.status).toBe(400);
    expect(await stored("long@example.hu")).toBeNull();
  });
});

describe("list, edit the note, remove", () => {
  it("lists every entry, newest first", async () => {
    const token = admin();
    await send("POST", "/api/staff/allowlist", token, { email: "first@example.hu" });
    await new Promise((resolve) => setTimeout(resolve, 5));
    await send("POST", "/api/staff/allowlist", token, { email: "second@example.hu", note: "B" });
    const { entries } = await (
      await send("GET", "/api/staff/allowlist", token)
    ).json<{ entries: { email: string; note?: string }[] }>();
    // KV keeps what earlier tests of this file added: look at this test's two.
    const mine = entries.filter((entry) => /^(first|second)@/.test(entry.email));
    expect(mine.map((entry) => entry.email)).toEqual(["second@example.hu", "first@example.hu"]);
    expect(mine[0]?.note).toBe("B");
    expect(mine[1]).not.toHaveProperty("note");
  });

  it("edits the note, keeping who added the entry, and an empty note clears it", async () => {
    const token = admin();
    await addToAllowlist("edit@example.hu", "old");
    const edited = await send("PUT", "/api/staff/allowlist", token, {
      email: "Edit@example.hu",
      note: "new note",
    });
    expect(edited.status).toBe(200);
    expect(await stored("edit@example.hu")).toMatchObject({ note: "new note", addedBy: "test" });
    await send("PUT", "/api/staff/allowlist", token, { email: "edit@example.hu", note: "" });
    expect(await stored("edit@example.hu")).not.toHaveProperty("note");
  });

  it("answers not_found when the entry to edit is not listed", async () => {
    const response = await send("PUT", "/api/staff/allowlist", admin(), {
      email: "ghost@example.hu",
      note: "x",
    });
    expect(response.status).toBe(404);
  });

  it("removes an entry and leaves no trace", async () => {
    await addToAllowlist("gone@example.hu", "leaver");
    const response = await send("DELETE", "/api/staff/allowlist?email=Gone%40example.hu", admin());
    expect(await response.json()).toEqual({ removed: true });
    expect(await stored("gone@example.hu")).toBeNull();
    const again = await send("DELETE", "/api/staff/allowlist?email=gone%40example.hu", admin());
    expect(await again.json()).toEqual({ removed: false });
  });
});

describe("add many", () => {
  it("adds the good lines and reports each refused one by its line", async () => {
    await addToAllowlist("already@example.hu");
    const text = [
      "anna@example.hu Kiss Anna, 2/5",
      "",
      "broken-line",
      "Bela@Example.hu",
      "already@example.hu",
      "anna@example.hu again",
    ].join("\n");
    const response = await send("POST", "/api/staff/allowlist/bulk", admin(), { text });
    expect(response.status).toBe(200);
    const body = await response.json<{
      added: { email: string; note?: string; addedBy: string }[];
      errors: { line: number; code: string }[];
    }>();
    expect(body.added.map((entry) => entry.email)).toEqual(["anna@example.hu", "bela@example.hu"]);
    expect(body.added[0]).toMatchObject({ note: "Kiss Anna, 2/5", addedBy: "ada-admin" });
    expect(body.errors).toEqual([
      expect.objectContaining({ line: 3, code: "invalid_email" }),
      expect.objectContaining({ line: 5, code: "already_listed" }),
      expect.objectContaining({ line: 6, code: "duplicate" }),
    ]);
    expect(await stored("anna@example.hu")).toMatchObject({ addedBy: "ada-admin" });
    expect(await stored("bela@example.hu")).not.toBeNull();
  });

  it("refuses more than 500 lines and adds none of them", async () => {
    const text = Array.from({ length: 501 }, (_, i) => `u${i}@example.hu`).join("\n");
    const response = await send("POST", "/api/staff/allowlist/bulk", admin(), { text });
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ error: { code: "too_many_entries" } });
    expect(await stored("u0@example.hu")).toBeNull();
  });

  it("takes exactly 500", async () => {
    const text = Array.from({ length: 500 }, (_, i) => `v${i}@example.hu`).join("\n");
    const response = await send("POST", "/api/staff/allowlist/bulk", admin(), { text });
    const body = await response.json<{ added: unknown[]; errors: unknown[] }>();
    expect(body.added).toHaveLength(500);
    expect(body.errors).toEqual([]);
  });
});
