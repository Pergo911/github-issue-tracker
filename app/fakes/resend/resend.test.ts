import { describe, expect, it } from "vitest";
import { createTestWorld } from "../testing/world.ts";

// Resend's send and retrieve endpoints as documented (resend.com/docs/api-reference), at the HTTP seam.

const valid = {
  from: "Rózsa Társasház <reports@mail.berautoapp.hu>",
  to: ["resident@example.hu"],
  subject: "Bejelentés #7 — „Csöpög a csap” — lezárva",
  text: "Lezártuk.",
  reply_to: "gondnok@example.org",
};

async function setup() {
  const test = await createTestWorld();
  const send = (
    json: unknown,
    headers: Record<string, string> = {},
    token: string | null = "re_test",
  ) =>
    test.client.resend("POST", "/emails", { ...(token === null ? {} : { token }), json, headers });
  return { ...test, send };
}

describe("POST /emails", () => {
  it("accepts a valid message with HTTP 200 and an id, and puts it in the outbox", async () => {
    const { send, control } = await setup();
    const reply = await send(valid);
    expect(reply.status).toBe(200);
    expect(reply.json.id).toMatch(/^[0-9a-f-]{36}$/);
    const [mail] = control.outbox();
    expect(mail).toMatchObject({
      id: reply.json.id,
      from: valid.from,
      to: ["resident@example.hu"],
      subject: valid.subject,
      text: "Lezártuk.",
      html: null,
      reply_to: ["gondnok@example.org"],
    });
  });

  it("accepts `to` as a string, and keeps Hungarian text and the em dash intact", async () => {
    const { send, control } = await setup();
    await send({ ...valid, to: "resident@example.hu" });
    expect(control.latestMailTo("resident@example.hu")?.subject).toBe(valid.subject);
  });

  it("requires a User-Agent: without one the request is blocked at the edge, as Resend's is", async () => {
    const { client } = await setup();
    const reply = await client.resend("POST", "/emails", {
      token: "re_test",
      json: valid,
      omitUserAgent: true,
    });
    expect(reply.status).toBe(403);
    expect(reply.text).toBe("error code: 1010");
  });

  it("requires an API key", async () => {
    const { send } = await setup();
    const reply = await send(valid, {}, null);
    expect(reply.status).toBe(401);
    expect(reply.json).toMatchObject({ statusCode: 401, name: "missing_api_key" });
  });

  it.each([
    ["from", { from: undefined }],
    ["to", { to: undefined }],
    ["subject", { subject: undefined }],
  ])("answers 422 missing_required_field without `%s`", async (field, override) => {
    const { send, control } = await setup();
    const reply = await send({ ...valid, ...override });
    expect(reply.status).toBe(422);
    expect(reply.json).toMatchObject({ statusCode: 422, name: "missing_required_field" });
    expect(reply.json.message).toContain(field);
    expect(control.outbox()).toEqual([]);
  });

  it("answers 422 without a text or html body", async () => {
    const { send } = await setup();
    const reply = await send({ ...valid, text: undefined });
    expect(reply.status).toBe(422);
    expect(reply.json.message).toContain("html");
  });

  it("answers 422 for an invalid address, more than 50 recipients and malformed tags", async () => {
    const { send } = await setup();
    expect((await send({ ...valid, to: ["not-an-address"] })).json.name).toBe("invalid_parameter");
    expect((await send({ ...valid, from: "nobody" })).status).toBe(422);
    const many = Array.from({ length: 51 }, (_, n) => `r${n}@example.hu`);
    expect((await send({ ...valid, to: many })).status).toBe(422);
    expect((await send({ ...valid, tags: [{ name: "kind", value: "két szó" }] })).status).toBe(422);
    expect((await send({ ...valid, tags: [{ name: "kind", value: "otp" }] })).status).toBe(200);
  });

  it("answers 403 for a sender domain that is not verified, once domains are configured", async () => {
    const { send, control } = await setup();
    control.configure({ verifiedDomains: ["mail.berautoapp.hu"] });
    expect((await send(valid)).status).toBe(200);
    const rejected = await send({ ...valid, from: "reports@example.com" });
    expect(rejected.status).toBe(403);
    expect(rejected.json.message).toContain("not verified");
  });

  it("rejects a body that is not JSON", async () => {
    const { client } = await setup();
    const reply = await client.resend("POST", "/emails", {
      token: "re_test",
      headers: { "content-type": "application/json" },
    });
    expect(reply.status).toBe(422);
  });

  it("answers 404 and 405 for other paths and methods", async () => {
    const { client } = await setup();
    expect((await client.resend("GET", "/nothing", { token: "re_test" })).status).toBe(404);
    expect((await client.resend("DELETE", "/emails", { token: "re_test" })).status).toBe(405);
  });
});

describe("idempotency keys", () => {
  it("answers a repeat of the same key and body with the same id, and sends nothing twice", async () => {
    const { send, control } = await setup();
    const first = await send(valid, { "idempotency-key": "confirm/7" });
    const second = await send(valid, { "idempotency-key": "confirm/7" });
    expect(second.status).toBe(200);
    expect(second.json.id).toBe(first.json.id);
    expect(control.outbox()).toHaveLength(1);
  });

  it("answers 409 invalid_idempotent_request for the same key with a changed body", async () => {
    const { send, control } = await setup();
    await send(valid, { "idempotency-key": "confirm/7" });
    const changed = await send({ ...valid, subject: "Másik" }, { "idempotency-key": "confirm/7" });
    expect(changed.status).toBe(409);
    expect(changed.json.name).toBe("invalid_idempotent_request");
    expect(control.outbox()).toHaveLength(1);
  });

  it("forgets a key after 24 hours of the fake clock", async () => {
    const { send, control } = await setup();
    await send(valid, { "idempotency-key": "k" });
    control.advanceClock(24 * 3_600_000 + 1);
    const again = await send({ ...valid, subject: "Másik" }, { "idempotency-key": "k" });
    expect(again.status).toBe(200);
    expect(control.outbox()).toHaveLength(2);
  });

  it("answers 400 invalid_idempotency_key for a key of the wrong length", async () => {
    const { send } = await setup();
    const reply = await send(valid, { "idempotency-key": "k".repeat(257) });
    expect(reply.status).toBe(400);
    expect(reply.json.name).toBe("invalid_idempotency_key");
  });

  it("answers 409 concurrent_idempotent_requests while a request with the key is held in flight", async () => {
    const { world, send, control, origin } = await setup();
    control.addFault({ service: "resend", effect: { type: "timeout" } });
    const aborter = new AbortController();
    const held = world.handle(
      new Request(`${origin}/resend/emails`, {
        method: "POST",
        headers: {
          authorization: "Bearer re_test",
          "user-agent": "t",
          "content-type": "application/json",
          "idempotency-key": "k",
        },
        body: JSON.stringify(valid),
        signal: aborter.signal,
      }),
    );
    held.catch(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, 10));
    const concurrent = await send(valid, { "idempotency-key": "k" });
    expect(concurrent.status).toBe(409);
    expect(concurrent.json.name).toBe("concurrent_idempotent_requests");
    aborter.abort();
    await expect(held).rejects.toMatchObject({ name: "AbortError" });
    // Once the first one has ended without sending, the key is free again.
    expect((await send(valid, { "idempotency-key": "k" })).status).toBe(200);
  });
});

describe("limits, switched on by a test", () => {
  it("answers 429 rate_limit_exceeded past the per-second limit, and is off by default", async () => {
    const { send, control } = await setup();
    for (let n = 0; n < 15; n++) expect((await send(valid)).status).toBe(200);
    control.clearOutbox();
    control.setResendRateLimit(10);
    const statuses: number[] = [];
    for (let n = 0; n < 12; n++) statuses.push((await send(valid)).status);
    expect(statuses.slice(0, 10).every((status) => status === 200)).toBe(true);
    expect(statuses.slice(10)).toEqual([429, 429]);
    control.advanceClock(1_000);
    expect((await send(valid)).status).toBe(200);
  });

  it("answers any failure a test scripts, such as the daily quota, without sending", async () => {
    const { send, control } = await setup();
    control.addFault({
      service: "resend",
      effect: {
        type: "status",
        status: 429,
        body: {
          statusCode: 429,
          name: "daily_quota_exceeded",
          message: "You have reached your daily email sending quota.",
        },
      },
    });
    const reply = await send(valid);
    expect(reply.json.name).toBe("daily_quota_exceeded");
    expect(control.outbox()).toEqual([]);
  });
});

describe("the outbox and GET /emails/{id}", () => {
  it("lists mail, finds the latest to an address (case-insensitively) and clears", async () => {
    const { send, control } = await setup();
    await send({ ...valid, subject: "one" });
    await send({ ...valid, subject: "two" });
    await send({ ...valid, to: ["other@example.hu"], subject: "three" });
    expect(control.outbox().map((mail) => mail.subject)).toEqual(["one", "two", "three"]);
    expect(control.outbox("RESIDENT@example.hu").map((mail) => mail.subject)).toEqual([
      "one",
      "two",
    ]);
    expect(control.latestMailTo("resident@example.hu")?.subject).toBe("two");
    expect(control.latestMailTo("nobody@example.hu")).toBeNull();
    control.clearOutbox();
    expect(control.outbox()).toEqual([]);
  });

  it("retrieves a sent message in Resend's shape: reply_to as an array, html null, a Postgres timestamp", async () => {
    const { send, client } = await setup();
    const { json } = await send(valid);
    const reply = await client.resend("GET", `/emails/${json.id}`, { token: "re_test" });
    expect(reply.status).toBe(200);
    expect(reply.json).toMatchObject({
      object: "email",
      id: json.id,
      to: ["resident@example.hu"],
      from: valid.from,
      subject: valid.subject,
      text: "Lezártuk.",
      html: null,
      reply_to: ["gondnok@example.org"],
      last_event: "delivered",
    });
    expect(reply.json.created_at).toMatch(/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d\.\d{6}\+00$/);
    expect((await client.resend("GET", "/emails/missing", { token: "re_test" })).status).toBe(404);
  });
});
