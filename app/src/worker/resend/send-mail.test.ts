import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { fakeWorld } from "../testing/world.ts";
import { ResendError, sendMail } from "./send-mail.ts";

const message = {
  from: "Rózsa Társasház <reports@mail.test>",
  to: "resident@example.hu",
  subject: "Bejelentés #7 — „Csöpög a csap” — lezárva",
  text: "Lezártuk.",
  replyTo: "gondnok@example.org",
};

describe("sendMail", () => {
  it("delivers a plain-text mail into the fake outbox, the test email of ticket #22", async () => {
    const { id } = await sendMail(env, message);
    const mail = fakeWorld().control.latestMailTo("resident@example.hu");
    expect(mail).toMatchObject({
      id,
      from: message.from,
      to: ["resident@example.hu"],
      subject: message.subject,
      text: "Lezártuk.",
      html: null,
      reply_to: ["gondnok@example.org"],
    });
  });

  it("sends what Resend needs: a bearer key, a User-Agent, JSON, reply_to in snake case, an idempotency key", async () => {
    let seen: Request | undefined;
    const recording: typeof fetch = (input, init) => {
      seen = new Request(input, init);
      return fetch(seen.clone());
    };
    await sendMail(env, { ...message, idempotencyKey: "confirm/7" }, { fetch: recording });
    expect(seen!.url).toBe("https://world.test/resend/emails");
    expect(seen!.headers.get("authorization")).toBe(`Bearer ${env.RESEND_API_KEY}`);
    expect(seen!.headers.get("user-agent")).toBeTruthy();
    expect(seen!.headers.get("content-type")).toBe("application/json");
    expect(seen!.headers.get("idempotency-key")).toBe("confirm/7");
    const body = (await seen!.json()) as Record<string, unknown>;
    expect(body).toMatchObject({ reply_to: "gondnok@example.org", to: ["resident@example.hu"] });
    expect("html" in body).toBe(false);
    expect("replyTo" in body).toBe(false);
  });

  it("makes a retry with the same idempotency key harmless", async () => {
    const first = await sendMail(env, { ...message, idempotencyKey: "k1" });
    const second = await sendMail(env, { ...message, idempotencyKey: "k1" });
    expect(second.id).toBe(first.id);
    expect(fakeWorld().control.outbox()).toHaveLength(1);
  });

  it("raises ResendError with Resend's status and name for a refusal, which is definite", async () => {
    fakeWorld().control.configure({ verifiedDomains: ["mail.berautoapp.hu"] });
    const error = await sendMail(env, message).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ResendError);
    expect(error).toMatchObject({ status: 403, code: "validation_error", uncertain: false });
    expect(fakeWorld().control.outbox()).toEqual([]);
  });

  it("names the quota and rate-limit failures so callers can tell them apart", async () => {
    fakeWorld().control.addFault({
      service: "resend",
      effect: {
        type: "status",
        status: 429,
        body: { statusCode: 429, name: "daily_quota_exceeded", message: "quota" },
      },
    });
    await expect(sendMail(env, message)).rejects.toMatchObject({
      status: 429,
      code: "daily_quota_exceeded",
    });
  });

  it("treats a 5xx, a lost connection and a timeout as uncertain: the mail may have gone", async () => {
    const { control } = fakeWorld();
    control.addFault({ service: "resend", effect: { type: "status", status: 503 } });
    await expect(sendMail(env, message)).rejects.toMatchObject({ status: 503, uncertain: true });

    control.addFault({ service: "resend", effect: { type: "lost-response" } });
    await expect(sendMail(env, message)).rejects.toMatchObject({ uncertain: true, status: null });
    // It was sent, even though the Worker never heard.
    expect(control.outbox()).toHaveLength(1);

    control.addFault({ service: "resend", effect: { type: "timeout" } });
    await expect(sendMail(env, message, { timeoutMs: 30 })).rejects.toMatchObject({
      uncertain: true,
      status: null,
    });
  });

  it("refuses to send without a recipient before asking Resend", async () => {
    await expect(sendMail(env, { ...message, to: [] })).rejects.toMatchObject({ status: 422 });
  });
});
