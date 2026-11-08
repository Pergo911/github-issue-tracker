import { DurableObject } from "cloudflare:workers";
import { notImplemented } from "./stub.ts";

/**
 * Report gate, one per issue number (SPEC 4.5, 5): comment and reissue budgets, mapping recovery, the
 * deletion tombstone. A stub until the tickets that need it give it behaviour.
 */
export class ReportGate extends DurableObject<Env> {
  override fetch(): Response {
    return notImplemented("ReportGate");
  }
}
