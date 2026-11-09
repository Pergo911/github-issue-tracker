import { DurableObject } from "cloudflare:workers";

/**
 * Report gate, one per issue number (SPEC 4.5, 5): the single writer of a Report's three KV mappings, so
 * finalization, Reissue and Erasure can be serialized on it. This ticket (#23) writes the mappings of a new
 * Report; the budgets, recovery and the deletion tombstone arrive with the tickets that need them.
 */
export class ReportGate extends DurableObject<Env> {
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
