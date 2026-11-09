import { DurableObject } from "cloudflare:workers";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Global gate, one per Deployment (SPEC 4.5, 5): the codes issued today, for the daily code budget.
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
}
