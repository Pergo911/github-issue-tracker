import type { GitHubIssuesWebhookPayload } from "../../src/shared/github/types.ts";

export interface WebhookTarget {
  /** Hands the signed request to the Worker. Resolves with its response; a rejection is a failed delivery. */
  deliver: (request: Request) => Promise<Response>;
  /** The webhook secret the deliveries are signed with (the Worker's `GITHUB_WEBHOOK_SECRET`). */
  secret: string;
  /** Where the delivery goes, e.g. `http://127.0.0.1:5173/api/github/webhook`. */
  url: string;
}

export interface DeliveryAttempt {
  /** The HTTP status the Worker answered, or `null` when the request failed outright. */
  status: number | null;
  error?: string;
}

export interface Delivery {
  /** `X-GitHub-Delivery`. The same GUID is reused on redelivery, as on GitHub. */
  id: string;
  event: "issues";
  action: GitHubIssuesWebhookPayload["action"];
  issueNumber: number;
  attempts: DeliveryAttempt[];
}

/** `sha256=<hex>` over the raw body, as GitHub's `X-Hub-Signature-256`. */
export async function signPayload(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)),
  );
  return `sha256=${Array.from(signature, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

interface Queued {
  delivery: Delivery;
  body: string;
}

/**
 * Delivers `issues` webhooks to the Worker for every change (SPEC 3.2): signed, with a delivery id, one at a
 * time in the order the changes happened. GitHub gives no ordering guarantee and may deliver twice, so the
 * hub has switches for both: `hold` collects deliveries and `release({ reverse })` sends them (backwards), and
 * `duplicates` sends every delivery twice with the same id. Failed deliveries are not retried.
 */
export class WebhookHub {
  readonly #target: () => WebhookTarget | null;
  readonly #log: Delivery[] = [];
  readonly #bodies = new Map<string, string>();
  #held: Queued[] | null = null;
  #duplicates = false;
  #chain: Promise<void> = Promise.resolve();

  constructor(target: () => WebhookTarget | null) {
    this.#target = target;
  }

  /** Called with the payload of one change. Returns before the delivery happens. */
  emit(payload: GitHubIssuesWebhookPayload): void {
    const delivery: Delivery = {
      id: crypto.randomUUID(),
      event: "issues",
      action: payload.action,
      issueNumber: payload.issue.number,
      attempts: [],
    };
    const queued = { delivery, body: JSON.stringify(payload) };
    this.#log.push(delivery);
    this.#bodies.set(delivery.id, queued.body);
    if (this.#held) this.#held.push(queued);
    else this.#enqueue(queued);
  }

  hold(): void {
    this.#held ??= [];
  }

  /** Sends everything held, newest first when `reverse` (out-of-order delivery), and stops holding. */
  release(options: { reverse?: boolean } = {}): void {
    const held = this.#held ?? [];
    this.#held = null;
    for (const queued of options.reverse ? held.reverse() : held) this.#enqueue(queued);
  }

  setDuplicates(on: boolean): void {
    this.#duplicates = on;
  }

  /** Resolves when every delivery handed over so far has been answered. */
  async flush(): Promise<void> {
    let chain: Promise<void>;
    do {
      chain = this.#chain;
      await chain;
    } while (chain !== this.#chain);
  }

  deliveries(): Delivery[] {
    return this.#log.map((delivery) => structuredClone(delivery));
  }

  /** GitHub's manual "Redeliver": the same body and delivery id again. */
  redeliver(id: string): void {
    const delivery = this.#log.find((candidate) => candidate.id === id);
    const body = this.#bodies.get(id);
    if (!delivery || body === undefined) throw new Error(`No delivery ${id}`);
    this.#enqueue({ delivery, body });
  }

  clear(): void {
    this.#log.length = 0;
    this.#bodies.clear();
    this.#held = null;
    this.#duplicates = false;
  }

  #enqueue(queued: Queued): void {
    this.#chain = this.#chain.then(async () => {
      await this.#send(queued);
      if (this.#duplicates) await this.#send(queued);
    });
  }

  async #send({ delivery, body }: Queued): Promise<void> {
    const target = this.#target();
    if (!target) {
      delivery.attempts.push({ status: null, error: "no webhook target is configured" });
      return;
    }
    const headers: Record<string, string> = {
      "content-type": "application/json",
      "user-agent": "GitHub-Hookshot/fake",
      "x-github-event": delivery.event,
      "x-github-delivery": delivery.id,
      "x-github-hook-id": "100000001",
      "x-github-hook-installation-target-type": "repository",
      "x-github-hook-installation-target-id": "800001",
      "x-hub-signature-256": await signPayload(target.secret, body),
    };
    try {
      const response = await target.deliver(
        new Request(target.url, { method: "POST", headers, body }),
      );
      await response.arrayBuffer();
      delivery.attempts.push({ status: response.status });
    } catch (error) {
      delivery.attempts.push({
        status: null,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
