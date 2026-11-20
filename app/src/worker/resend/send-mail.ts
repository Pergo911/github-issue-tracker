import { WORKER_USER_AGENT } from "@shared/github/constants.ts";

/**
 * Sends one plain-text email through Resend's REST API with raw `fetch` (SPEC 3.1, 4.6): the base URL is the
 * `RESEND_API_BASE` variable, so locally it is the fake Resend. Text only: `html` is never sent.
 */

export interface MailMessage {
  /** `Display Name <local@verified-subdomain>`. */
  from: string;
  to: string | string[];
  subject: string;
  text: string;
  replyTo?: string;
  /** Makes a repeated call (an alarm retry) harmless: Resend keeps a key for 24 hours. */
  idempotencyKey?: string;
}

/** Resend answered with an error, or no answer arrived (`status` is `null`). */
export class ResendError extends Error {
  readonly status: number | null;
  /** Resend's error `name`, e.g. `daily_quota_exceeded`, `rate_limit_exceeded`, `validation_error`. */
  readonly code: string | null;
  /** Whether the mail may have been sent anyway: a 5xx, a lost connection or a timeout. */
  readonly uncertain: boolean;

  constructor(message: string, status: number | null, code: string | null, uncertain: boolean) {
    super(message);
    this.name = "ResendError";
    this.status = status;
    this.code = code;
    this.uncertain = uncertain;
  }
}

export interface SendMailDeps {
  fetch?: typeof fetch;
  timeoutMs?: number;
}

export async function sendMail(
  env: Pick<Env, "RESEND_API_BASE" | "RESEND_API_KEY">,
  message: MailMessage,
  deps: SendMailDeps = {},
): Promise<{ id: string }> {
  const recipients = Array.isArray(message.to) ? message.to : [message.to];
  if (recipients.length === 0) throw new ResendError("a mail needs a recipient", 422, null, false);

  const headers: Record<string, string> = {
    authorization: `Bearer ${env.RESEND_API_KEY}`,
    "content-type": "application/json",
    "user-agent": WORKER_USER_AGENT,
  };
  if (message.idempotencyKey) headers["idempotency-key"] = message.idempotencyKey;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deps.timeoutMs ?? 10_000);
  let response: Response;
  try {
    response = await (deps.fetch ?? fetch)(`${env.RESEND_API_BASE.replace(/\/+$/, "")}/emails`, {
      method: "POST",
      headers,
      signal: controller.signal,
      body: JSON.stringify({
        from: message.from,
        to: recipients,
        subject: message.subject,
        text: message.text,
        ...(message.replyTo ? { reply_to: message.replyTo } : {}),
      }),
    });
  } catch {
    throw new ResendError("No answer from Resend", null, null, true);
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    let name: string | null = null;
    let detail = `Resend answered ${response.status}`;
    try {
      const body = await response.json<{ name?: string; message?: string }>();
      name = body.name ?? null;
      detail = body.message ?? detail;
    } catch {
      // not JSON: keep the generic text
    }
    throw new ResendError(detail, response.status, name, response.status >= 500);
  }
  return response.json<{ id: string }>();
}
