import { DurableObject } from "cloudflare:workers";
import type { ReportFields } from "@shared/reports/validate.ts";
import { loadConfig } from "../config/load.ts";
import { findMarkerMatches } from "../recovery/scan.ts";
import { constantTimeEqual, generateOtp, sha256Hex } from "../util/crypto.ts";
import { sendTemplate } from "../util/request.ts";
import { reach } from "./probe.ts";

/** The code's life, its cooldown and its caps (SPEC 4.5). */
export const OTP_TTL_MS = 10 * 60_000;
export const OTP_COOLDOWN_MS = 60_000;
export const OTP_MAX_PER_HOUR = 5;
export const OTP_MAX_PER_DAY = 10;
export const OTP_MAX_WRONG_GUESSES = 5;
/** A completed submission can be replayed from its receipt this long (SPEC 4.1). */
export const RECEIPT_TTL_MS = 24 * 60 * 60_000;
/** A dispatch fence this old with no issue recorded is a crashed create: it becomes uncertain (ADR 0005). */
export const FENCE_STALE_MS = 60_000;
/** Delays between recovery passes after a failure; the last repeats for as long as the attempt is unfinished. */
const RECOVERY_BACKOFF_MS = [10_000, 30_000, 120_000, 600_000, 1_800_000] as const;

const HOUR_MS = 60 * 60_000;
const DAY_MS = 24 * HOUR_MS;

interface OtpState {
  hash: string;
  expiresAt: number;
  wrongGuesses: number;
}

/** The verified, not yet completed submission: kept until it is complete or a person reconciles it (SPEC 4.1). */
interface PendingAttempt {
  credentialHash: string;
  fingerprint: string;
  /** The verified email, kept only while the attempt is unresolved. */
  email: string;
  fields: ReportFields;
  marker: string;
  statusToken: string;
  /**
   * `dispatching` is the fence, persisted before the create, so anything after it is uncertain (ADR 0005);
   * `uncertain` awaits a marker scan; `unresolved` needs a person; `created` has an issue number and awaits
   * KV finalization through the Report gate.
   */
  phase: "dispatching" | "uncertain" | "unresolved" | "created";
  issueNumber?: number;
  startedAt: number;
  /** What a Reporter or an operator quotes: the first bytes of the credential's hash. */
  reference: string;
  /** Wall-clock time the fence was persisted (the stale check). */
  fenceAt: number;
  /** When the next unattended recovery pass is due. */
  dueAt: number;
  failures: number;
  /** The operator registry knows this attempt. */
  registered?: boolean;
}

export interface CompletionReceipt {
  credentialHash: string;
  fingerprint: string;
  issueNumber: number;
  title: string;
  statusToken: string;
  /** The Report gate's token generation this receipt's link belongs to: a later Reissue voids it. */
  generation: number;
  completedAt: number;
  expiresAt: number;
}

/** Where a submission stands, for the Reporter's tab and the SPA's "Still saving" state. */
export type RecoverView =
  | { kind: "none" }
  | { kind: "saving" }
  | { kind: "needs_help"; reference: string }
  | { kind: "complete"; receipt: CompletionReceipt; completedNow: boolean };

/** An attempt as the operator sees it. The Reporter's description is not part of it. */
export interface AttemptDetail {
  reference: string;
  emailHash: string;
  email: string;
  phase: string;
  issueNumber: number | null;
  marker: string;
  title: string;
  category: string;
  location: string;
  startedAt: number;
}

/** The reference a Reporter reads out: eight hex digits of the credential's hash, as `ABCD-1234`. */
export function referenceOf(credentialHash: string): string {
  const hex = credentialHash.slice(0, 8).toUpperCase();
  return `${hex.slice(0, 4)}-${hex.slice(4)}`;
}

export interface SubmissionInput {
  /** The code the Reporter typed. */
  code: string;
  credentialHash: string;
  fingerprint: string;
  email: string;
  fields: ReportFields;
  marker: string;
  statusToken: string;
  now: number;
}

export type VerifyOutcome =
  /** The code was right and is consumed; the attempt and its dispatch fence are persisted. Create the issue now. */
  | { kind: "verified" }
  /** Wrong, expired, burned or never issued: indistinguishable (SPEC 4.1). */
  | { kind: "invalid_code" }
  /** This attempt already completed: the original result, not a new Report. */
  | { kind: "replay"; receipt: CompletionReceipt }
  /** An unfinished attempt exists for this address: never create another (ADR 0005). */
  | { kind: "pending"; reference: string; unresolved: boolean }
  /** The credential belongs to a different payload. */
  | { kind: "conflict" };

/**
 * Email gate, one per SHA-256 of a normalized email (SPEC 4.5, 5): the OTP and its caps, the pending
 * submission and its recovery, and the 24-hour receipts. Every synchronous stretch is atomic (input gates): the
 * guess is counted before it is compared, and consuming the code and persisting the attempt cannot be split.
 * Recovery is persisted phase by phase (never one long `blockConcurrencyWhile`) and driven by the Reporter's
 * resume calls and by an alarm that is re-armed deliberately.
 */
export class EmailGate extends DurableObject<Env> {
  /**
   * Issues a code unless the address is cooling down or capped (it then answers `null`, silently). The caller
   * sends the mail in `waitUntil`.
   */
  async issueCode(now: number = Date.now(), source?: () => number): Promise<string | null> {
    const kv = this.ctx.storage.kv;
    const sends = (kv.get<number[]>("sends") ?? []).filter((at) => now - at < DAY_MS);
    const last = sends.at(-1);
    if (last !== undefined && now - last < OTP_COOLDOWN_MS) return null;
    if (sends.filter((at) => now - at < HOUR_MS).length >= OTP_MAX_PER_HOUR) return null;
    if (sends.length >= OTP_MAX_PER_DAY) return null;

    const code = generateOtp(source);
    const otp: OtpState = {
      hash: await this.hashCode(code),
      expiresAt: now + OTP_TTL_MS,
      wrongGuesses: 0,
    };
    kv.put("otp", otp);
    kv.put("sends", [...sends, now]);
    return code;
  }

  async verifyAndSubmit(input: SubmissionInput): Promise<VerifyOutcome> {
    const kv = this.ctx.storage.kv;
    const receipt = kv.get<CompletionReceipt>(`receipt:${input.credentialHash}`);
    if (receipt && receipt.expiresAt > input.now) {
      return receipt.fingerprint === input.fingerprint
        ? { kind: "replay", receipt }
        : { kind: "conflict" };
    }
    const attempt = kv.get<PendingAttempt>("attempt");
    if (attempt?.credentialHash === input.credentialHash) {
      return attempt.fingerprint === input.fingerprint
        ? {
            kind: "pending",
            reference: attempt.reference,
            unresolved: attempt.phase === "unresolved",
          }
        : { kind: "conflict" };
    }

    const otp = kv.get<OtpState>("otp");
    if (!otp || otp.expiresAt <= input.now) {
      if (otp) kv.delete("otp");
      return { kind: "invalid_code" };
    }
    // Count the guess before comparing it, so a crash or a concurrent guess cannot give a free try.
    kv.put("otp", { ...otp, wrongGuesses: otp.wrongGuesses + 1 });
    const matches = constantTimeEqual(otp.hash, await this.hashCode(input.code));
    // The await above lets another request in: read the state again before deciding.
    const current = kv.get<OtpState>("otp");
    if (!current || current.hash !== otp.hash) return { kind: "invalid_code" };

    if (!matches) {
      if (current.wrongGuesses >= OTP_MAX_WRONG_GUESSES) kv.delete("otp");
      return { kind: "invalid_code" };
    }
    const blocking = kv.get<PendingAttempt>("attempt");
    if (blocking !== undefined) {
      return {
        kind: "pending",
        reference: blocking.reference,
        unresolved: blocking.phase === "unresolved",
      };
    }

    kv.delete("otp");
    const pending: PendingAttempt = {
      credentialHash: input.credentialHash,
      fingerprint: input.fingerprint,
      email: input.email,
      fields: input.fields,
      marker: input.marker,
      statusToken: input.statusToken,
      phase: "dispatching",
      startedAt: input.now,
      reference: referenceOf(input.credentialHash),
      fenceAt: Date.now(),
      dueAt: Date.now() + FENCE_STALE_MS,
      failures: 0,
    };
    kv.put("attempt", pending);
    await this.schedule();
    reach("after-fence");
    return { kind: "verified" };
  }

  private attemptOf(credentialHash: string): PendingAttempt | undefined {
    const attempt = this.ctx.storage.kv.get<PendingAttempt>("attempt");
    return attempt?.credentialHash === credentialHash ? attempt : undefined;
  }

  /** The issue exists: persist its number at once. Whatever the attempt was (even unresolved), it now has an issue. */
  async recordIssue(credentialHash: string, issueNumber: number): Promise<void> {
    const attempt = this.attemptOf(credentialHash);
    if (!attempt || attempt.phase === "created") return;
    this.ctx.storage.kv.put("attempt", {
      ...attempt,
      phase: "created",
      issueNumber,
      failures: 0,
      dueAt: Date.now() + FENCE_STALE_MS,
    });
    await this.schedule();
    reach("after-record-issue");
  }

  /** The create failed or the Worker lost track of it after the fence: it may or may not have happened. */
  async markUncertain(credentialHash: string): Promise<void> {
    const attempt = this.attemptOf(credentialHash);
    if (attempt?.phase !== "dispatching") return;
    this.ctx.storage.kv.put("attempt", {
      ...attempt,
      phase: "uncertain",
      dueAt: Date.now() + 5_000,
    });
    await this.schedule();
  }

  private recovering: Promise<RecoverView> | null = null;

  /**
   * Moves the attempt as far as it can go without a person (single-flight): a stale fence becomes uncertain, an
   * uncertain create is settled by the marker scan (never by another POST), a known issue is finalized through
   * the Report gate. Answers where it stands.
   */
  recover(now: number = Date.now(), unattended = false): Promise<RecoverView> {
    this.recovering ??= this.runRecover(now, unattended).finally(() => {
      this.recovering = null;
    });
    return this.recovering;
  }

  private async fail(credentialHash: string): Promise<void> {
    const attempt = this.attemptOf(credentialHash);
    if (!attempt) return;
    const failures = attempt.failures + 1;
    const wait = RECOVERY_BACKOFF_MS[
      Math.min(failures - 1, RECOVERY_BACKOFF_MS.length - 1)
    ] as number;
    this.ctx.storage.kv.put("attempt", { ...attempt, failures, dueAt: Date.now() + wait });
    await this.schedule();
  }

  private async runRecover(now: number, unattended: boolean): Promise<RecoverView> {
    const kv = this.ctx.storage.kv;
    for (let step = 0; step < 8; step++) {
      const attempt = kv.get<PendingAttempt>("attempt");
      if (!attempt) return { kind: "none" };
      switch (attempt.phase) {
        case "dispatching": {
          if (now - attempt.fenceAt < FENCE_STALE_MS) return { kind: "saving" };
          kv.put("attempt", { ...attempt, phase: "uncertain" });
          break;
        }
        case "uncertain": {
          let matches: number[];
          try {
            matches = await findMarkerMatches(this.env, attempt.marker);
          } catch (error) {
            console.error("the marker scan failed; it is retried", error);
            await this.fail(attempt.credentialHash);
            return { kind: "saving" };
          }
          const current = this.attemptOf(attempt.credentialHash);
          if (current?.phase !== "uncertain") break;
          const [only] = matches;
          if (matches.length === 1 && only !== undefined) {
            kv.put("attempt", { ...current, phase: "created", issueNumber: only, failures: 0 });
          } else {
            // Zero or several: a person decides. Never another POST.
            kv.put("attempt", { ...current, phase: "unresolved", failures: 0 });
          }
          break;
        }
        case "unresolved": {
          if (!attempt.registered) {
            try {
              await this.env.GLOBAL_GATE.getByName("deployment").recoveryRegister({
                reference: attempt.reference,
                emailHash: await sha256Hex(attempt.email),
                phase: "unresolved",
                since: attempt.fenceAt,
              });
            } catch (error) {
              console.error("the operator registry could not be written; it is retried", error);
              await this.fail(attempt.credentialHash);
              return { kind: "needs_help", reference: attempt.reference };
            }
            const current = this.attemptOf(attempt.credentialHash);
            if (current) kv.put("attempt", { ...current, registered: true });
          }
          await this.schedule();
          return { kind: "needs_help", reference: attempt.reference };
        }
        case "created": {
          const issueNumber = attempt.issueNumber as number;
          const reportGate = this.env.REPORT_GATE.getByName(String(issueNumber));
          try {
            await reportGate.register({
              issueNumber,
              email: attempt.email,
              statusToken: attempt.statusToken,
              attempt: {
                emailHash: await sha256Hex(attempt.email),
                credentialHash: attempt.credentialHash,
              },
            });
            const view = await reportGate.converge(unattended);
            if (view?.state === "deleted") {
              // The Report was erased before this attempt could finish: there is nothing left to finalize.
              await this.dropAttempt(attempt.credentialHash);
              return { kind: "none" };
            }
          } catch (error) {
            console.error("finalizing the Report failed; it is retried", error);
            await this.fail(attempt.credentialHash);
            return { kind: "saving" };
          }
          const receipt = kv.get<CompletionReceipt>(`receipt:${attempt.credentialHash}`);
          if (receipt) return { kind: "complete", receipt, completedNow: true };
          return this.attemptOf(attempt.credentialHash) ? { kind: "saving" } : { kind: "none" };
        }
      }
    }
    return { kind: "saving" };
  }

  /** The Reporter's tab asks (with its credential's hash) where the submission stands. Reads only that attempt. */
  async resume(credentialHash: string, now: number = Date.now()): Promise<RecoverView> {
    const receipt = this.ctx.storage.kv.get<CompletionReceipt>(`receipt:${credentialHash}`);
    if (receipt && receipt.expiresAt > now) {
      return { kind: "complete", receipt, completedNow: false };
    }
    if (!this.attemptOf(credentialHash)) return { kind: "none" };
    return this.recover(now);
  }

  /**
   * The issue and all three mappings are acknowledged: drop the payload and keep only the replayable receipt
   * for 24 hours. A still-valid receipt of another attempt is never overwritten (they are keyed by credential).
   */
  async complete(
    credentialHash: string,
    now: number = Date.now(),
    options: { generation: number; unattended?: boolean },
  ): Promise<CompletionReceipt | null> {
    const kv = this.ctx.storage.kv;
    const existing = kv.get<CompletionReceipt>(`receipt:${credentialHash}`);
    const attempt = this.attemptOf(credentialHash);
    if (!attempt || attempt.issueNumber === undefined) return existing ?? null;
    // SPEC 4.1: a receipt carries the submission's original token and generation (1), never a successor token
    // issued by a Reissue during finalization.
    const receipt: CompletionReceipt = {
      credentialHash,
      fingerprint: attempt.fingerprint,
      issueNumber: attempt.issueNumber,
      title: attempt.fields.title,
      statusToken: attempt.statusToken,
      generation: 1,
      completedAt: now,
      expiresAt: now + RECEIPT_TTL_MS,
    };
    kv.put(`receipt:${credentialHash}`, receipt);
    kv.delete("attempt");
    await this.unregister(attempt);
    await this.schedule();
    if (options.unattended && options.generation === 1) {
      // Unattended alarm completion (tab closed): still send the best-effort confirmation email (SPEC 4.1).
      try {
        const config = await loadConfig(this.env.KV);
        if (config !== null) {
          const base = this.env.APP_URL.replace(/\/+$/, "");
          await sendTemplate(this.env, config, "submissionConfirmation", attempt.email, {
            number: receipt.issueNumber,
            title: receipt.title,
            link: `${base}/status/${receipt.statusToken}`,
          });
        }
      } catch (error) {
        console.error("the unattended confirmation email could not be sent", error);
      }
    }
    return receipt;
  }

  /** Forgets an attempt whose Report was deleted (Erasure) or that an operator discarded. */
  async dropAttempt(credentialHash: string): Promise<boolean> {
    const attempt = this.attemptOf(credentialHash);
    if (!attempt) return false;
    this.ctx.storage.kv.delete("attempt");
    await this.unregister(attempt);
    await this.schedule();
    return true;
  }

  /** Forgets a completion receipt whose Report was deleted (Erasure): its replay would only reveal a dead link. */
  async dropReceipt(credentialHash: string): Promise<boolean> {
    const kv = this.ctx.storage.kv;
    const had = kv.delete(`receipt:${credentialHash}`);
    await this.schedule();
    return had;
  }

  private async unregister(attempt: PendingAttempt): Promise<void> {
    if (!attempt.registered) return;
    try {
      await this.env.GLOBAL_GATE.getByName("deployment").recoveryRemove(attempt.reference);
    } catch (error) {
      console.error("the operator registry entry could not be removed", error);
    }
  }

  /** The retained attempt for the operator, or `null`. */
  async inspect(): Promise<AttemptDetail | null> {
    const attempt = this.ctx.storage.kv.get<PendingAttempt>("attempt");
    if (!attempt) return null;
    return {
      reference: attempt.reference,
      emailHash: await sha256Hex(attempt.email),
      email: attempt.email,
      phase: attempt.phase,
      issueNumber: attempt.issueNumber ?? null,
      marker: attempt.marker,
      title: attempt.fields.title,
      category: attempt.fields.category,
      location: attempt.fields.location,
      startedAt: attempt.startedAt,
    };
  }

  /** The operator verified an existing issue for this attempt: it is adopted and finalized. Never a new create. */
  async associate(issueNumber: number): Promise<RecoverView> {
    const attempt = this.ctx.storage.kv.get<PendingAttempt>("attempt");
    if (!attempt || attempt.phase === "created") return { kind: "none" };
    await this.recordIssue(attempt.credentialHash, issueNumber);
    return this.recover();
  }

  /** The operator discards the attempt and the partial mappings its issue may have gained. */
  async discard(): Promise<boolean> {
    const attempt = this.ctx.storage.kv.get<PendingAttempt>("attempt");
    if (!attempt) return false;
    if (attempt.issueNumber !== undefined) {
      await this.env.REPORT_GATE.getByName(String(attempt.issueNumber)).forget();
    }
    return this.dropAttempt(attempt.credentialHash);
  }

  /** One alarm serves the receipts' expiry and the attempt's next unattended pass: the earliest of them. */
  private async schedule(): Promise<void> {
    const kv = this.ctx.storage.kv;
    let next: number | null = null;
    for (const [, value] of kv.list<CompletionReceipt>({ prefix: "receipt:" })) {
      next = Math.min(next ?? value.expiresAt, value.expiresAt);
    }
    const attempt = kv.get<PendingAttempt>("attempt");
    if (attempt && (attempt.phase !== "unresolved" || !attempt.registered)) {
      next = Math.min(next ?? attempt.dueAt, attempt.dueAt);
    }
    if (next === null) await this.ctx.storage.deleteAlarm();
    else await this.ctx.storage.setAlarm(Math.max(next, Date.now() + 1));
  }

  /** Receipts clean themselves up after 24 hours; an unfinished attempt gets its next pass. */
  override async alarm(): Promise<void> {
    const kv = this.ctx.storage.kv;
    const now = Date.now();
    for (const [key, value] of kv.list<CompletionReceipt>({ prefix: "receipt:" })) {
      if (value.expiresAt <= now) kv.delete(key);
    }
    const attempt = kv.get<PendingAttempt>("attempt");
    if (attempt && attempt.dueAt <= now) {
      try {
        await this.recover(now, true);
      } catch (error) {
        console.error("an unattended recovery pass failed; it is re-armed", error);
        await this.fail(attempt.credentialHash);
      }
    }
    await this.schedule();
  }

  private hashCode(code: string): Promise<string> {
    return sha256Hex(`otp:${code}`);
  }
}
