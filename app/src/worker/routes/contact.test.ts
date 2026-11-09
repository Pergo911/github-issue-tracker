import { env, exports } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { referenceConfig } from "@shared/seed/reference-config.ts";
import { addToAllowlist, fakeWorld } from "../testing/world.ts";

// Reveal-contact and the Staff Reissue (SPEC 4.3, 4.4), through the real Worker against the fake GitHub: Maintenance
// staff and up, checked here with the caller's own token, and the new link goes only to the Reporter's mailbox.

const send = (path: string, token: string | undefined, body: unknown) =>
  exports.default.fetch(`https://reports.test${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
const reveal = (token: string | undefined, issueNumber: number) =>
  send("/api/staff/reveal-contact", token, { issueNumber });
const reissue = (token: string | undefined, issueNumber: number) =>
  send("/api/staff/reissue", token, { issueNumber });

const staff = (login: string, role: "read" | "triage" | "admin") =>
  fakeWorld().control.addStaff({ login, role }).token;

const email = "anna.kiss@example.hu";
const link = "OLDtokenOLDtokenOLDtok";
let number = 0;

beforeEach(async () => {
  await env.KV.put("config", JSON.stringify(referenceConfig));
  number = fakeWorld().control.createReport({ title: "Elakadt a lift" }).number;
  await env.KV.put(`issue-email:${number}`, email);
  await env.KV.put(`issue-token:${number}`, link);
  await env.KV.put(`status-token:${link}`, String(number));
});

afterEach(async () => {
  await env.KV.delete("config");
  for (const prefix of ["allowlist:", "issue-email:", "status-token:", "issue-token:"]) {
    for (const { name } of (await env.KV.list({ prefix })).keys) await env.KV.delete(name);
  }
});

describe("who may reveal a contact or Reissue", () => {
  it("refuses no token and a Viewer on both endpoints, and reveals nothing", async () => {
    const viewer = staff("vera", "read");
    for (const call of [reveal, reissue]) {
      expect((await call(undefined, number)).status).toBe(401);
      const refused = await call(viewer, number);
      expect(refused.status).toBe(403);
      expect(JSON.stringify(await refused.json())).not.toContain(email);
    }
    expect(fakeWorld().control.outbox(email)).toEqual([]);
    expect(await env.KV.get(`issue-token:${number}`)).toBe(link);
  });
});

describe("POST /api/staff/reveal-contact", () => {
  it("gives Maintenance staff the email, the current Status link and the Allowlist note while listed", async () => {
    await addToAllowlist(email, "Kiss Anna, 2/4");
    const answer = await reveal(staff("mate", "triage"), number);
    expect(answer.status).toBe(200);
    expect(await answer.json()).toEqual({
      email,
      statusUrl: `https://reports.test/status/${link}`,
      allowlist: { note: "Kiss Anna, 2/4" },
    });
  });

  it("leaves the Allowlist out once the address is no longer listed", async () => {
    const answer = await reveal(staff("ada", "admin"), number);
    expect(await answer.json()).toEqual({
      email,
      statusUrl: `https://reports.test/status/${link}`,
      allowlist: null,
    });
  });

  it("answers not_found for a Report without a contact", async () => {
    const answer = await reveal(staff("mate", "triage"), number + 50);
    expect(answer.status).toBe(404);
    expect(await answer.json()).toEqual({ error: { code: "not_found" } });
  });
});

describe("POST /api/staff/reissue", () => {
  it("replaces the link, mails the new one only to the Reporter and never returns it", async () => {
    const answer = await reissue(staff("mate", "triage"), number);
    expect(answer.status).toBe(200);
    const body = await answer.json<Record<string, unknown>>();
    expect(body).toEqual({ sent: true });

    const fresh = (await env.KV.get(`issue-token:${number}`)) as string;
    expect(fresh).not.toBe(link);
    expect(await env.KV.get(`status-token:${link}`)).toBeNull();
    expect(await env.KV.get(`status-token:${fresh}`)).toBe(String(number));
    const mails = fakeWorld().control.outbox(email);
    expect(mails).toHaveLength(1);
    expect(mails[0]?.text).toContain(`https://reports.test/status/${fresh}`);
    expect(JSON.stringify(body)).not.toContain(fresh);
  });

  it("is not capped: a fourth Reissue in a day still works", async () => {
    const token = staff("mate", "triage");
    for (let round = 0; round < 4; round++) {
      expect((await reissue(token, number)).status, `round ${round}`).toBe(200);
    }
  });

  it("answers not_found for a Report without a mapping", async () => {
    const answer = await reissue(staff("mate", "triage"), number + 50);
    expect(answer.status).toBe(404);
  });
});
