import { DurableObject } from "cloudflare:workers";
import { issueExists } from "../recovery/scan.ts";
import { kvWriter } from "./kv-writer.ts";
import { reach } from "./probe.ts";

const DAY_MS = 24 * 60 * 60 * 1000;

/** The per-Report daily budgets of SPEC 4.5: Reporter comments, and Reissues by a link holder. */
export const REPORT_DAILY_LIMITS = { comment: 20, reissue: 3 } as const;
export type ReportBudget = keyof typeof REPORT_DAILY_LIMITS;

/** What a Reissue did, as the gate reports it. */
export type TokenReplacement =
  | { kind: "replaced"; email: string; newToken: string; oldToken: string }
  /** The Report has no token or no address in KV (erased, or never finalized): nothing was changed. */
  | { kind: "unknown" }
  /** The presented link is no longer the Report's current one (it was replaced meanwhile): nothing was changed. */
  | { kind: "stale" };

/**
 * Report gate, one per issue number (SPEC 4.1, 4.5, 5): the single writer of a Report's three KV mappings, and
 * the owner of its lifecycle: finalization progress, the token generation a Reissue bumps, and the deletion
 * tombstone an Erasure leaves. Finalization is registered here before any KV write, persisted phase by phase,
 * and repaired with backoff by an alarm, so a lost write, a restart or a delayed retry never replays the initial
 * puts blindly: each pass rechecks that the issue still exists and which lifecycle state and token are current
 * (ADR 0005). Nothing here uses `blockConcurrencyWhile`; the phases are the coordination.
 */

/** Delays between repair passes after a failure, the last repeated for as long as the repair is needed. */
export const REPAIR_BACKOFF_MS = [10_000, 30_000, 120_000, 600_000, 1_800_000] as const;
/** The fallback alarm armed when finalization is registered, in case the registering request dies. */
export const FIRST_ALARM_MS = 30_000;

export type LifecycleState = "finalizing" | "final" | "deleted";

interface Lifecycle {
  state: LifecycleState;
  issueNumber: number;
  email: string;
  statusToken: string;
  /** Bumped by every Reissue. A receipt of an older generation reveals nothing. */
  generation: number;
  written: { email: boolean; statusToken: boolean; issueToken: boolean };
  /** Replaced tokens whose `status-token:` entry still has to go. */
  stale: string[];
  /** The Email gate attempt waiting to be told that finalization is done. */
  attempt: { emailHash: string; credentialHash: string } | null;
  /** Where the 24-hour receipt of the registering attempt lives: kept after completion, so an Erasure can cancel it. */
  receipt?: { emailHash: string; credentialHash: string } | null;
  failures: number;
}

export interface LifecycleView {
  state: LifecycleState;
  issueNumber: number;
  generation: number;
  /** The current token; `null` once the Report is deleted. */
  statusToken: string | null;
}

const LIFE = "lifecycle";

function viewOf(life: Lifecycle): LifecycleView {
  return {
    state: life.state,
    issueNumber: life.issueNumber,
    generation: life.generation,
    statusToken: life.state === "deleted" ? null : life.statusToken,
  };
}

const writesPending = (life: Lifecycle): boolean =>
  !life.written.email ||
  !life.written.statusToken ||
  !life.written.issueToken ||
  life.stale.length > 0;

export class ReportGate extends DurableObject<Env> {
  private running: Promise<LifecycleView | null> | null = null;

  private read(): Lifecycle | undefined {
    return this.ctx.storage.kv.get<Lifecycle>(LIFE);
  }

  private write(life: Lifecycle): void {
    this.ctx.storage.kv.put(LIFE, life);
  }

  /** Spends one unit of today's budget (the UTC day): `false` once the day's limit is reached. Atomic. */
  take(budget: ReportBudget, now: number = Date.now()): boolean {
    const day = Math.floor(now / DAY_MS);
    const kv = this.ctx.storage.kv;
    const stored = kv.get<{ day: number; comment: number; reissue: number }>("daily");
    const counts = stored?.day === day ? stored : { day, comment: 0, reissue: 0 };
    if (counts[budget] >= REPORT_DAILY_LIMITS[budget]) return false;
    kv.put("daily", { ...counts, [budget]: counts[budget] + 1 });
    return true;
  }

  /**
   * Replaces a Report's Status token for a Reissue (SPEC 4.3) on the lifecycle: a new token on the next generation,
   * written new-first and the old one deleted by the repair. `presentedToken` is the link a holder used: a second
   * Reissue from a link that was just replaced finds it stale and changes nothing. Staff pass none. The new token
   * is returned to the Worker only, never to a caller. A Report with no lifecycle record (mappings written before
   * the lifecycle existed) is replaced directly in KV.
   */
  async replaceToken(input: {
    issueNumber: number;
    newToken: string;
    presentedToken?: string;
  }): Promise<TokenReplacement> {
    const { issueNumber, newToken, presentedToken } = input;
    const life = this.read();
    if (life) {
      if (life.state === "deleted" || !life.email) return { kind: "unknown" };
      // Written but gone from KV: erased out of band, so there is no address to tell.
      if (life.written.email && (await this.env.KV.get(`issue-email:${issueNumber}`)) === null) {
        return { kind: "unknown" };
      }
      if (presentedToken !== undefined && presentedToken !== life.statusToken) {
        return { kind: "stale" };
      }
      const { email, statusToken: oldToken } = life;
      try {
        await this.reissue(newToken);
      } catch (error) {
        // The new generation is recorded and an alarm repairs the mappings: the Reissue itself stands.
        console.error("a Reissue repair pass failed; it is re-armed", error);
      }
      return { kind: "replaced", email, newToken, oldToken };
    }
    const [oldToken, email] = await Promise.all([
      this.env.KV.get(`issue-token:${issueNumber}`),
      this.env.KV.get(`issue-email:${issueNumber}`),
    ]);
    if (oldToken === null || email === null) return { kind: "unknown" };
    if (presentedToken !== undefined && presentedToken !== oldToken) return { kind: "stale" };
    // The new mapping first, so there is never a moment with no working link.
    await this.env.KV.put(`status-token:${newToken}`, String(issueNumber));
    await this.env.KV.put(`issue-token:${issueNumber}`, newToken);
    await this.env.KV.delete(`status-token:${oldToken}`);
    return { kind: "replaced", email, newToken, oldToken };
  }

  /**
   * Registers a new Report's finalization with its fixed values, before any KV write, and arms a fallback alarm.
   * Registering again changes nothing: the first registration owns the values.
   */
  async register(input: {
    issueNumber: number;
    email: string;
    statusToken: string;
    attempt: { emailHash: string; credentialHash: string } | null;
  }): Promise<LifecycleView> {
    const existing = this.read();
    if (existing) return viewOf(existing);
    const life: Lifecycle = {
      state: "finalizing",
      issueNumber: input.issueNumber,
      email: input.email,
      statusToken: input.statusToken,
      generation: 1,
      written: { email: false, statusToken: false, issueToken: false },
      stale: [],
      attempt: input.attempt,
      receipt: input.attempt,
      failures: 0,
    };
    this.write(life);
    await this.ctx.storage.setAlarm(Date.now() + FIRST_ALARM_MS);
    reach("after-register");
    return viewOf(life);
  }

  view(): LifecycleView | null {
    const life = this.read();
    return life ? viewOf(life) : null;
  }

  /** Runs one repair pass (single-flight): every missing mapping is written, then the attempt is completed. */
  converge(): Promise<LifecycleView | null> {
    this.running ??= this.runConverge().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private async runConverge(): Promise<LifecycleView | null> {
    const first = this.read();
    if (!first) return null;
    try {
      if (first.state !== "deleted" && writesPending(first)) {
        // The issue may have been deleted since the first try: then nothing may be written.
        if (!(await issueExists(this.env, first.issueNumber))) {
          await this.tombstone();
          return this.view();
        }
      }
      for (let pass = 0; pass < 20; pass++) {
        await this.writePending();
        const life = this.read();
        if (!life || life.state === "deleted") return this.view();
        if (writesPending(life)) continue;
        if (life.state !== "final") this.write({ ...life, state: "final", failures: 0 });
        if (life.attempt) {
          reach("before-complete");
          const receipt = await this.env.EMAIL_GATE.getByName(life.attempt.emailHash).complete(
            life.attempt.credentialHash,
            Date.now(),
            { generation: life.generation, statusToken: life.statusToken },
          );
          // Told, or the attempt is already gone (discarded, or completed by another pass): nothing left to tell.
          const after = this.read();
          if (after && (receipt !== null || after.generation === life.generation)) {
            this.write({ ...after, attempt: null });
          }
        }
        const done = this.read();
        if (done && !writesPending(done)) break;
      }
    } catch (error) {
      const life = this.read();
      if (life && life.state !== "deleted") {
        const failures = life.failures + 1;
        this.write({ ...life, failures });
        const wait = REPAIR_BACKOFF_MS[
          Math.min(failures - 1, REPAIR_BACKOFF_MS.length - 1)
        ] as number;
        await this.ctx.storage.setAlarm(Date.now() + wait);
      }
      throw error;
    }
    return this.view();
  }

  /** Writes whatever is missing, one KV entry at a time, persisting progress and re-reading the lifecycle after each. */
  private async writePending(): Promise<void> {
    for (let step = 0; step < 50; step++) {
      const life = this.read();
      if (!life || life.state === "deleted") return;
      const next = this.nextStep(life);
      if (!next) return;
      if (next.kind === "put") await kvWriter.put(this.env, next.key, next.value);
      else await kvWriter.delete(this.env, next.key);

      const after = this.read();
      if (!after) return;
      if (after.state === "deleted") {
        // An Erasure landed while the write was in flight: take back what it may have missed.
        if (next.kind === "put") await kvWriter.delete(this.env, next.key);
        return;
      }
      // A Reissue landed: what was written belongs to an older generation; look again.
      if (after.generation !== life.generation) continue;
      this.write(next.mark(after));
      reach(next.probe);
    }
  }

  private nextStep(life: Lifecycle):
    | {
        kind: "put" | "delete";
        key: string;
        value: string;
        probe: "after-kv-issue-email" | "after-kv-status-token" | "after-kv-issue-token";
        mark: (current: Lifecycle) => Lifecycle;
      }
    | undefined {
    const n = life.issueNumber;
    if (!life.written.email) {
      return {
        kind: "put",
        key: `issue-email:${n}`,
        value: life.email,
        probe: "after-kv-issue-email",
        mark: (c) => ({ ...c, written: { ...c.written, email: true } }),
      };
    }
    if (!life.written.statusToken) {
      return {
        kind: "put",
        key: `status-token:${life.statusToken}`,
        value: String(n),
        probe: "after-kv-status-token",
        mark: (c) => ({ ...c, written: { ...c.written, statusToken: true } }),
      };
    }
    if (!life.written.issueToken) {
      return {
        kind: "put",
        key: `issue-token:${n}`,
        value: life.statusToken,
        probe: "after-kv-issue-token",
        mark: (c) => ({ ...c, written: { ...c.written, issueToken: true } }),
      };
    }
    const stale = life.stale[0];
    if (stale !== undefined) {
      return {
        kind: "delete",
        key: `status-token:${stale}`,
        value: "",
        probe: "after-kv-status-token",
        mark: (c) => ({ ...c, stale: c.stale.filter((token) => token !== stale) }),
      };
    }
    return undefined;
  }

  /**
   * A Reissue (SPEC 4.3, a later ticket): a new token on the next generation. The repair in flight, if any, picks
   * the new values up on its next look; an alarm is armed so it is never left to chance.
   */
  async reissue(newToken: string): Promise<LifecycleView | null> {
    const life = this.read();
    if (!life || life.state === "deleted") return life ? viewOf(life) : null;
    this.write({
      ...life,
      state: "finalizing",
      generation: life.generation + 1,
      statusToken: newToken,
      written: { ...life.written, statusToken: false, issueToken: false },
      stale: [...life.stale, life.statusToken],
    });
    await this.ctx.storage.setAlarm(Date.now() + 1);
    if (this.running === null) await this.converge();
    return this.view();
  }

  /**
   * An operator discarded the attempt that registered this Report: its partial mappings and its lifecycle record
   * go, with no tombstone, so the issue can be associated again later.
   */
  async forget(): Promise<void> {
    const life = this.read();
    this.ctx.storage.kv.delete(LIFE);
    if (!life) return;
    const keys = [
      `issue-email:${life.issueNumber}`,
      `issue-token:${life.issueNumber}`,
      ...[life.statusToken, ...life.stale].filter(Boolean).map((token) => `status-token:${token}`),
    ];
    for (const key of keys) await kvWriter.delete(this.env, key);
  }

  /**
   * The deletion tombstone (SPEC 4.2, 5): the Report is gone, so its mappings, its attempt locator, its receipt and
   * any delayed repair go with it. The issue-number record stays: GitHub never reuses it. `issueNumber` is the
   * number the `deleted` webhook names, for a Report whose gate holds no lifecycle (mappings written before it
   * existed, or deleted before it was ever registered): the tombstone then still stops a later registration.
   */
  async tombstone(issueNumber?: number): Promise<void> {
    const life = this.read();
    const number = life?.issueNumber ?? issueNumber ?? 0;
    const gone: Lifecycle = {
      state: "deleted",
      issueNumber: number,
      email: "",
      statusToken: "",
      generation: life?.generation ?? 1,
      written: { email: true, statusToken: true, issueToken: true },
      stale: [],
      attempt: null,
      receipt: null,
      failures: 0,
    };
    // Recorded first: from here on every repair pass and Reissue sees the deletion.
    this.write(gone);
    await this.ctx.storage.deleteAlarm();
    if (number === 0) return;
    const current = await this.env.KV.get(`issue-token:${number}`);
    const tokens = [life?.statusToken, ...(life?.stale ?? []), current].filter(
      (token): token is string => Boolean(token),
    );
    const keys = [
      `issue-email:${number}`,
      `issue-token:${number}`,
      ...new Set(tokens.map((token) => `status-token:${token}`)),
    ];
    for (const key of keys) await kvWriter.delete(this.env, key);
    const locator = life?.attempt ?? life?.receipt;
    if (locator) {
      const emailGate = this.env.EMAIL_GATE.getByName(locator.emailHash);
      await emailGate.dropAttempt(locator.credentialHash);
      await emailGate.dropReceipt(locator.credentialHash);
    }
  }

  /** Alarms are at-least-once and the built-in retries are finite: failure is caught and re-armed here. */
  override async alarm(): Promise<void> {
    try {
      await this.converge();
    } catch (error) {
      console.error("a repair pass failed; it is re-armed", error);
    }
    const life = this.read();
    if (life && life.state !== "deleted" && (writesPending(life) || life.attempt)) {
      if ((await this.ctx.storage.getAlarm()) === null) {
        const wait = REPAIR_BACKOFF_MS[
          Math.min(Math.max(life.failures, 1) - 1, REPAIR_BACKOFF_MS.length - 1)
        ] as number;
        await this.ctx.storage.setAlarm(Date.now() + wait);
      }
    }
  }
}
