import type { Clock } from "../clock.ts";
import { jsonResponse, Router, readJson } from "../http.ts";

/** One message the fake accepted: what Resend's `GET /emails/{id}` shows, plus the idempotency key. */
export interface SentMail {
  id: string;
  from: string;
  to: string[];
  cc: string[];
  bcc: string[];
  reply_to: string[];
  subject: string;
  text: string | null;
  html: string | null;
  headers: Record<string, string> | null;
  tags: { name: string; value: string }[];
  /** ISO 8601, on the world clock. */
  sentAt: string;
  idempotencyKey: string | null;
}

interface IdempotencyEntry {
  fingerprint: string;
  at: number;
  response: { id: string } | null;
  /** True while the first request with this key is still being processed (a held, timed-out request). */
  inFlight: boolean;
}

const IDEMPOTENCY_WINDOW_MS = 24 * 3_600_000;
const EMAIL = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[^\s@<>()[\]\\,;:"]+$/;

/** `Name <a@b.hu>` or `a@b.hu`: the bare address, or `null` when it is not valid. */
export function parseAddress(value: string): string | null {
  const match = /<([^<>]+)>\s*$/.exec(value.trim());
  const address = (match?.[1] ?? value).trim();
  return EMAIL.test(address) ? address : null;
}

function resendError(status: number, name: string, message: string): Response {
  return jsonResponse({ statusCode: status, name, message }, status);
}

/** Postgres-style `YYYY-MM-DD HH:MM:SS.ffffff+00`, which Resend's retrieve endpoint uses. */
function postgresTimestamp(iso: string): string {
  return `${iso.replace("T", " ").replace("Z", "")}000+00`;
}

/**
 * Resend's send and retrieve endpoints (`api.resend.com`), answering like Resend (SPEC 3.1, 4.6): the same
 * request shape, `{ id }` on success, the documented error bodies, the 24 hour idempotency table with both
 * 409s, and the mandatory `User-Agent`. Every accepted message lands in the outbox, which tests read.
 * Quotas and the 10 requests per second limit are off until a test asks for them (`setRateLimit`).
 */
export class ResendFake {
  readonly #clock: Clock;
  readonly #verifiedDomains: () => string[];
  readonly #router = new Router();
  readonly #outbox: SentMail[] = [];
  readonly #idempotency = new Map<string, IdempotencyEntry>();
  readonly #recentSends: number[] = [];
  #rateLimitPerSecond: number | null = null;

  constructor(options: { clock: Clock; verifiedDomains: () => string[] }) {
    this.#clock = options.clock;
    this.#verifiedDomains = options.verifiedDomains;
    this.#router.add("POST", "/emails", (c) => this.#send(c.request));
    this.#router.add("GET", "/emails/:id", (c) => {
      if (!c.request.headers.get("authorization")) {
        return resendError(401, "missing_api_key", "Missing API key in the authorization header.");
      }
      const mail = this.#outbox.find((candidate) => candidate.id === c.params["id"]);
      if (!mail) return resendError(404, "not_found", "Email not found");
      return jsonResponse({
        object: "email",
        id: mail.id,
        message_id: `<${mail.id}@fake.resend.test>`,
        to: mail.to,
        from: mail.from,
        created_at: postgresTimestamp(mail.sentAt),
        subject: mail.subject,
        html: mail.html,
        text: mail.text,
        bcc: mail.bcc,
        cc: mail.cc,
        reply_to: mail.reply_to,
        last_event: "delivered",
        scheduled_at: null,
        tags: mail.tags,
      });
    });
  }

  async handle(request: Request, path: string): Promise<Response> {
    if (!request.headers.get("user-agent")) {
      // What Resend's Cloudflare edge says when a request has no User-Agent.
      return new Response("error code: 1010", {
        status: 403,
        headers: { "content-type": "text/plain" },
      });
    }
    const matched = this.#router.match(request.method, path);
    if (matched === null) return resendError(404, "not_found", "Route not found");
    if (matched === "method") {
      return resendError(405, "method_not_allowed", "Method is not allowed for the requested path");
    }
    return matched.handler({ request, url: new URL(request.url), params: matched.params, path });
  }

  // ------------------------------------------------------------------------------ inspection

  outbox(to?: string): SentMail[] {
    const wanted = to?.toLowerCase();
    return this.#outbox
      .filter(
        (mail) =>
          wanted === undefined || mail.to.some((address) => address.toLowerCase() === wanted),
      )
      .map((mail) => structuredClone(mail));
  }

  latestTo(address: string): SentMail | null {
    return this.outbox(address).at(-1) ?? null;
  }

  clearOutbox(): void {
    this.#outbox.length = 0;
  }

  reset(): void {
    this.#outbox.length = 0;
    this.#idempotency.clear();
    this.#recentSends.length = 0;
    this.#rateLimitPerSecond = null;
  }

  /** Turns Resend's per-second limit on (its default is 10) or off (`null`). */
  setRateLimit(perSecond: number | null): void {
    this.#rateLimitPerSecond = perSecond;
  }

  /** Called while a held request is in flight, so a second request with the same key gets the 409. */
  markInFlight(key: string, fingerprint: string): void {
    this.#idempotency.set(key, {
      fingerprint,
      at: this.#clock.now(),
      response: null,
      inFlight: true,
    });
  }

  releaseInFlight(key: string): void {
    const entry = this.#idempotency.get(key);
    if (entry?.inFlight) this.#idempotency.delete(key);
  }

  // ---------------------------------------------------------------------------------- sending

  async #send(request: Request): Promise<Response> {
    const authorization = request.headers.get("authorization");
    if (!authorization)
      return resendError(401, "missing_api_key", "Missing API key in the authorization header.");
    if (!/^Bearer\s+\S+$/i.test(authorization)) {
      return resendError(401, "validation_error", "API key is invalid");
    }

    const raw = await readJson(request);
    if (
      raw === "invalid" ||
      raw === undefined ||
      raw === null ||
      typeof raw !== "object" ||
      Array.isArray(raw)
    ) {
      return resendError(422, "invalid_parameter", "The request body must be a JSON object.");
    }
    const body = raw as Record<string, unknown>;

    const key = request.headers.get("idempotency-key");
    if (key !== null && (key.length < 1 || key.length > 256)) {
      return resendError(400, "invalid_idempotency_key", "The key must be between 1-256 chars.");
    }

    const validation = this.#validate(body);
    if (validation) return validation;

    const fingerprint = JSON.stringify(body);
    if (key !== null) {
      this.#purgeIdempotency();
      const entry = this.#idempotency.get(key);
      if (entry) {
        if (entry.inFlight) {
          return resendError(
            409,
            "concurrent_idempotent_requests",
            "Same idempotency key used while the original request is still in progress. Try again later.",
          );
        }
        if (entry.fingerprint !== fingerprint) {
          return resendError(
            409,
            "invalid_idempotent_request",
            "This idempotency key has already been used on a request with a different payload.",
          );
        }
        return jsonResponse(entry.response);
      }
    }

    if (this.#rateLimitPerSecond !== null) {
      const now = this.#clock.now();
      while (this.#recentSends.length > 0 && now - (this.#recentSends[0] as number) >= 1000) {
        this.#recentSends.shift();
      }
      if (this.#recentSends.length >= this.#rateLimitPerSecond) {
        return resendError(
          429,
          "rate_limit_exceeded",
          "Too many requests. You can only make 10 requests per second.",
        );
      }
      this.#recentSends.push(now);
    }

    const list = (value: unknown): string[] =>
      value === undefined ? [] : (Array.isArray(value) ? value : [value]).map(String);
    const id = crypto.randomUUID();
    const mail: SentMail = {
      id,
      from: String(body["from"]),
      to: list(body["to"]),
      cc: list(body["cc"]),
      bcc: list(body["bcc"]),
      reply_to: list(body["reply_to"]),
      subject: String(body["subject"]),
      text: typeof body["text"] === "string" ? body["text"] : null,
      html: typeof body["html"] === "string" ? body["html"] : null,
      headers:
        body["headers"] && typeof body["headers"] === "object"
          ? (body["headers"] as Record<string, string>)
          : null,
      tags: Array.isArray(body["tags"]) ? (body["tags"] as { name: string; value: string }[]) : [],
      sentAt: new Date(this.#clock.now()).toISOString(),
      idempotencyKey: key,
    };
    this.#outbox.push(mail);
    if (key !== null) {
      this.#idempotency.set(key, {
        fingerprint,
        at: this.#clock.now(),
        response: { id },
        inFlight: false,
      });
    }
    return jsonResponse({ id });
  }

  #purgeIdempotency(): void {
    const now = this.#clock.now();
    for (const [key, entry] of this.#idempotency) {
      if (now - entry.at >= IDEMPOTENCY_WINDOW_MS) this.#idempotency.delete(key);
    }
  }

  #validate(body: Record<string, unknown>): Response | null {
    for (const field of ["from", "to", "subject"] as const) {
      const value = body[field];
      if (
        value === undefined ||
        value === null ||
        value === "" ||
        (Array.isArray(value) && value.length === 0)
      ) {
        return resendError(422, "missing_required_field", `Missing \`${field}\` field.`);
      }
    }
    if (
      body["html"] === undefined &&
      body["text"] === undefined &&
      body["template"] === undefined
    ) {
      return resendError(422, "missing_required_field", "Missing `html` or `text` field.");
    }
    if (typeof body["from"] !== "string" || typeof body["subject"] !== "string") {
      return resendError(422, "invalid_parameter", "`from` and `subject` must be strings.");
    }
    const from = parseAddress(body["from"]);
    if (!from)
      return resendError(
        422,
        "invalid_parameter",
        "Invalid `from` field. The email address needs to follow the `email@example.com` or `Name <email@example.com>` format.",
      );
    const recipients = (field: string): string[] | Response => {
      const value = body[field];
      if (value === undefined) return [];
      const list = Array.isArray(value) ? value : [value];
      for (const entry of list) {
        if (typeof entry !== "string" || !parseAddress(entry)) {
          return resendError(
            422,
            "invalid_parameter",
            `Invalid \`${field}\` field. The email address needs to follow the \`email@example.com\` or \`Name <email@example.com>\` format.`,
          );
        }
      }
      return list as string[];
    };
    const to = recipients("to");
    if (to instanceof Response) return to;
    if (to.length > 50)
      return resendError(
        422,
        "invalid_parameter",
        "The `to` field can have at most 50 recipients.",
      );
    for (const field of ["cc", "bcc", "reply_to"]) {
      const checked = recipients(field);
      if (checked instanceof Response) return checked;
    }
    if (body["tags"] !== undefined) {
      const valid =
        Array.isArray(body["tags"]) &&
        body["tags"].every(
          (tag) =>
            tag &&
            typeof tag === "object" &&
            /^[A-Za-z0-9_-]{1,256}$/.test(String((tag as Record<string, unknown>)["name"])) &&
            /^[A-Za-z0-9_-]{1,256}$/.test(String((tag as Record<string, unknown>)["value"])),
        );
      if (!valid)
        return resendError(
          422,
          "invalid_parameter",
          "Tags must be objects with ASCII letters, numbers, underscores or dashes.",
        );
    }
    const verified = this.#verifiedDomains();
    if (verified.length > 0) {
      const domain = from.split("@")[1]?.toLowerCase() ?? "";
      if (!verified.map((entry) => entry.toLowerCase()).includes(domain)) {
        return resendError(
          403,
          "validation_error",
          `The ${domain} domain is not verified. Please, add and verify your domain on https://resend.com/domains`,
        );
      }
    }
    return null;
  }
}
