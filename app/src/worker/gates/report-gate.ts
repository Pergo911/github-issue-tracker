import { DurableObject } from "cloudflare:workers";

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
 * Report gate, one per issue number (SPEC 4.5, 5): the single writer of a Report's three KV mappings, so
 * finalization, Reissue and Erasure can be serialized on it. This ticket (#23) writes the mappings of a new
 * Report; the budgets, recovery and the deletion tombstone arrive with the tickets that need them.
 */
export class ReportGate extends DurableObject<Env> {
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
   * Replaces a Report's Status token (SPEC 4.3): writes `status-token:<new>`, points `issue-token:<n>` at it and
   * deletes `status-token:<old>`, serialized with every other lifecycle step on this gate. `presentedToken` is
   * the link a holder used: a second Reissue from a link that was just replaced finds it stale and changes
   * nothing. Staff pass none. The new token is returned to the Worker only, never to a caller.
   */
  async replaceToken(input: {
    issueNumber: number;
    newToken: string;
    presentedToken?: string;
  }): Promise<TokenReplacement> {
    const { issueNumber, newToken, presentedToken } = input;
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
   * Writes `issue-email`, `status-token` and `issue-token` with the fixed values and resolves once KV has
   * acknowledged all three (SPEC 4.1). The values are plaintext: gated staff lookup needs them.
   */
  async writeMappings(input: {
    issueNumber: number;
    email: string;
    statusToken: string;
  }): Promise<void> {
    const { issueNumber, email, statusToken } = input;
    await Promise.all([
      this.env.KV.put(`issue-email:${issueNumber}`, email),
      this.env.KV.put(`status-token:${statusToken}`, String(issueNumber)),
      this.env.KV.put(`issue-token:${issueNumber}`, statusToken),
    ]);
  }
}
