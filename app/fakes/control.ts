import type { DeviceCodeInfo, ScriptedOutcome } from "./github/device-flow.ts";
import type { RepoRole, StateReason } from "./github/store.ts";
import type { Delivery } from "./github/webhooks.ts";
import type { SentMail } from "./resend/resend.ts";

/** A Report to seed straight into the fake GitHub, as the Bot created it (no webhooks by default). */
export interface ReportSpec {
  title: string;
  body?: string;
  /** Label names, e.g. `category:plumbing`. Missing labels are created. */
  labels?: string[];
  assignees?: string[];
  comments?: { author?: string; body: string }[];
  state?: "open" | "closed";
  stateReason?: Extract<StateReason, "completed" | "not_planned">;
  /** Seed a pull request instead (it comes back from the issues endpoints with a `pull_request` key). */
  pullRequest?: boolean;
  /** Deliver the `issues` webhooks this creation causes (default: no, the Report is "already there"). */
  webhooks?: boolean;
}

export interface StaffSpec {
  login: string;
  role: RepoRole;
}

export interface StaffGrant extends StaffSpec {
  /** A static token that never expires: use it as `Authorization: Bearer`. */
  token: string;
}

export interface FaultSpec {
  /** Which fake the fault hits. */
  service: "github" | "github-web" | "resend";
  method?: string;
  /** A regular expression tested against the path below the service prefix, e.g. `^/repos/.+/issues$`. */
  path?: string;
  effect:
    | { type: "timeout"; holdMs?: number }
    | { type: "status"; status: number; body?: unknown; headers?: Record<string, string> }
    /** The write is applied, then the connection drops before the response: "created, but the response was lost". */
    | { type: "lost-response" };
  /** How many matching requests it hits (default 1, `null` for every one until cleared). */
  times?: number | null;
  /** Let this many matching requests through first. */
  skip?: number;
}

export interface Violation {
  method: string;
  path: string;
  /** The protected address that appeared in the write. */
  address: string;
  where: "body" | "url";
}

export interface WorldSettings {
  unknownLabels?: "create" | "ignore";
  triageCanLabel?: boolean;
  /** Whether polling the device-flow token endpoint faster than `interval` answers `slow_down` (default true). */
  strictPolling?: boolean;
  /** Sender domains Resend accepts; empty accepts all. */
  verifiedDomains?: string[];
}

export interface WorldSummary {
  org: string;
  repo: string;
  bot: { login: string; accountId: number; appId: number; installationId: number };
  staff: StaffGrant[];
  issues: number;
  labels: number;
  mails: number;
  openDeviceCodes: DeviceCodeInfo[];
  faults: number;
  webhookTarget: string | null;
}

/**
 * Everything a test, the seed command or an agent can do to the local world besides speaking the fakes' wire
 * protocols. The same methods run in-process (Worker tests) and over HTTP (`POST /control/<method>` with the
 * JSON array of arguments, the dev server, end-to-end tests): the HTTP client is a proxy over this interface,
 * so the two cannot drift. Every argument and result is JSON.
 */
export interface Control {
  /** Forgets everything: GitHub state, tokens, device codes, mail, faults, webhooks, the clock, settings. */
  reset(): void;
  configure(settings: WorldSettings): void;
  summary(): WorldSummary;

  addStaff(spec: StaffSpec): StaffGrant;
  /** Creates the Appendix A labels, one Staff user per role and a handful of Reports. Idempotent per reset. */
  seed(): { staff: StaffGrant[]; reports: number[] };
  createReport(spec: ReportSpec): { number: number; id: number };
  /** Adds a comment to a Report as `author` (a Staff login), or as the Bot when none is given. */
  addComment(number: number, body: string, author?: string): { id: number };
  /** Deletes a Report the way an admin does in the GitHub UI: it goes, its `deleted` webhook is sent. */
  deleteReport(number: number): void;

  deviceCodes(): DeviceCodeInfo[];
  approveDeviceCode(userCode: string, login: string): void;
  denyDeviceCode(userCode: string): void;
  expireDeviceCode(userCode: string): void;
  /** The next token poll answers this outcome, once, whatever the code's state. */
  scriptNextDevicePoll(outcome: ScriptedOutcome | null): void;

  addFault(fault: FaultSpec): number;
  clearFaults(): void;

  /** Collects webhook deliveries instead of sending them, until `releaseWebhooks`. */
  holdWebhooks(): void;
  releaseWebhooks(options?: { reverse?: boolean }): void;
  /** Sends every delivery twice, with the same delivery id. */
  setWebhookDuplicates(on: boolean): void;
  /** Resolves when every webhook delivery so far has been answered by the Worker. */
  flushWebhooks(): Promise<void>;
  webhookDeliveries(): Delivery[];
  redeliverWebhook(id: string): void;

  outbox(to?: string): SentMail[];
  latestMailTo(address: string): SentMail | null;
  clearOutbox(): void;
  setResendRateLimit(perSecond: number | null): void;

  advanceClock(milliseconds: number): void;
  clockNow(): number;

  /** Registers an address (an Allowlist entry) that must never appear in a write to GitHub. */
  protectEmail(address: string): void;
  /** The writes that carried a protected address since the last call; empties the list. */
  takeViolations(): Violation[];
}

/** The same interface with every method asynchronous: what the HTTP client has to be. */
export type AsyncControl = {
  [K in keyof Control]: Control[K] extends (...args: infer A) => infer R
    ? (...args: A) => Promise<Awaited<R>>
    : never;
};

/** Wraps the in-process control so helpers written for `AsyncControl` accept it. */
export function asAsync(control: Control): AsyncControl {
  return new Proxy(control, {
    get: (target, name: string) => {
      const method = (target as unknown as Record<string, (...args: unknown[]) => unknown>)[name];
      return (...args: unknown[]) =>
        new Promise((resolve) => {
          resolve(method?.apply(target, args));
        });
    },
  }) as unknown as AsyncControl;
}

/** The control client over HTTP: `baseUrl` is the world's `/control` URL. */
export function remoteControl(
  baseUrl: string,
  fetcher: (input: string, init: RequestInit) => Promise<Response> = (input, init) =>
    fetch(input, init),
): AsyncControl {
  return new Proxy({} as AsyncControl, {
    get:
      (_target, method: string) =>
      async (...args: unknown[]) => {
        const response = await fetcher(`${baseUrl}/${method}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(args),
        });
        const text = await response.text();
        if (!response.ok) throw new Error(`control ${method} failed (${response.status}): ${text}`);
        return text === "" ? undefined : (JSON.parse(text) as { result: unknown }).result;
      },
  });
}
