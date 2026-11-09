import { DurableObject } from "cloudflare:workers";

const DAY_MS = 24 * 60 * 60 * 1000;

/** An unresolved or uncertain submission an operator may need to find by its reference (SPEC 4.1). */
export interface RecoveryEntry {
  reference: string;
  emailHash: string;
  phase: string;
  since: number;
}

/**
 * Global gate, one per Deployment (SPEC 4.5, 5): the codes issued today, for the daily code budget, and the
 * registry of submissions that need a person (a reference, the Email gate that holds it: no payload, no email).
 * Every OTP request spends one unit before anything per-email happens, so its answer never depends on
 * whether the address is listed. The day is the UTC day (the budget resets at 00:00 UTC).
 */
export class GlobalGate extends DurableObject<Env> {
  /** Spends one unit of today's budget: `false` once `budget` units are gone. Atomic. */
  take(budget: number, now: number = Date.now()): boolean {
    const day = Math.floor(now / DAY_MS);
    const kv = this.ctx.storage.kv;
    const stored = kv.get<{ day: number; spent: number }>("budget");
    const spent = stored?.day === day ? stored.spent : 0;
    if (spent >= budget) return false;
    kv.put("budget", { day, spent: spent + 1 });
    return true;
  }

  /** Records (or refreshes) an attempt that needs a person, so the operator can list it. */
  recoveryRegister(entry: RecoveryEntry): void {
    this.ctx.storage.kv.put(`recovery:${entry.reference}`, entry);
  }

  recoveryRemove(reference: string): void {
    this.ctx.storage.kv.delete(`recovery:${reference}`);
  }

  recoveryGet(reference: string): RecoveryEntry | null {
    return this.ctx.storage.kv.get<RecoveryEntry>(`recovery:${reference}`) ?? null;
  }

  recoveryList(): RecoveryEntry[] {
    return [...this.ctx.storage.kv.list<RecoveryEntry>({ prefix: "recovery:" })]
      .map(([, entry]) => entry)
      .sort((a, b) => a.since - b.since);
  }
}
