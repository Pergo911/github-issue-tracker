import { DurableObject } from "cloudflare:workers";
import type { ReportFields } from "@shared/reports/validate.ts";
import { constantTimeEqual, generateOtp, sha256Hex } from "../util/crypto.ts";

/** The code's life, its cooldown and its caps (SPEC 4.5). */
export const OTP_TTL_MS = 10 * 60_000;
export const OTP_COOLDOWN_MS = 60_000;
export const OTP_MAX_PER_HOUR = 5;
export const OTP_MAX_PER_DAY = 10;
export const OTP_MAX_WRONG_GUESSES = 5;
/** A completed submission can be replayed from its receipt this long (SPEC 4.1). */
export const RECEIPT_TTL_MS = 24 * 60 * 60_000;

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
  /** The dispatch fence: persisted before the create, so anything after it is uncertain (ADR 0005). */
  phase: "dispatching" | "created";
  issueNumber?: number;
  startedAt: number;
}

export interface CompletionReceipt {
  credentialHash: string;
  fingerprint: string;
  issueNumber: number;
  title: string;
  statusToken: string;
  completedAt: number;
  expiresAt: number;
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
  /** An unresolved attempt exists for this address: never create another (ADR 0005). Ticket #24 resumes it. */
  | { kind: "pending" }
  /** The credential belongs to a different payload. */
  | { kind: "conflict" };

/**
 * Email gate, one per SHA-256 of a normalized email (SPEC 4.5, 5): the OTP and its caps, and the pending
 * submission. Every method is synchronous inside the object, so each is atomic (input gates): the guess is
 * counted before it is compared, and consuming the code and persisting the attempt cannot be split.
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
      return attempt.fingerprint === input.fingerprint ? { kind: "pending" } : { kind: "conflict" };
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
    if (kv.get("attempt") !== undefined) return { kind: "pending" };

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
    };
    kv.put("attempt", pending);
    return { kind: "verified" };
  }

  /** The issue exists: persist its number at once. */
  recordIssue(credentialHash: string, issueNumber: number): void {
    const kv = this.ctx.storage.kv;
    const attempt = kv.get<PendingAttempt>("attempt");
    if (attempt?.credentialHash !== credentialHash) return;
    kv.put("attempt", { ...attempt, phase: "created", issueNumber });
  }

  /**
   * The issue and all three mappings are acknowledged: drop the payload and keep only the replayable receipt
   * for 24 hours. A still-valid receipt of another attempt is never overwritten (they are keyed by credential).
   */
  async complete(
    credentialHash: string,
    now: number = Date.now(),
  ): Promise<CompletionReceipt | null> {
    const kv = this.ctx.storage.kv;
    const attempt = kv.get<PendingAttempt>("attempt");
    if (attempt?.credentialHash !== credentialHash || attempt.issueNumber === undefined)
      return null;
    const receipt: CompletionReceipt = {
      credentialHash,
      fingerprint: attempt.fingerprint,
      issueNumber: attempt.issueNumber,
      title: attempt.fields.title,
      statusToken: attempt.statusToken,
      completedAt: now,
      expiresAt: now + RECEIPT_TTL_MS,
    };
    kv.put(`receipt:${credentialHash}`, receipt);
    kv.delete("attempt");
    await this.ctx.storage.setAlarm(now + RECEIPT_TTL_MS);
    return receipt;
  }

  /** Receipts clean themselves up after 24 hours. */
  override async alarm(): Promise<void> {
    const kv = this.ctx.storage.kv;
    const now = Date.now();
    let next: number | null = null;
    for (const [key, value] of kv.list<CompletionReceipt>({ prefix: "receipt:" })) {
      if (value.expiresAt <= now) kv.delete(key);
      else next = Math.min(next ?? value.expiresAt, value.expiresAt);
    }
    if (next !== null) await this.ctx.storage.setAlarm(next);
  }

  private hashCode(code: string): Promise<string> {
    return sha256Hex(`otp:${code}`);
  }
}
