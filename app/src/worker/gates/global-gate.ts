import { DurableObject } from "cloudflare:workers";
import { notImplemented } from "./stub.ts";

/**
 * Global gate, one per Deployment (SPEC 4.5, 5): the codes issued today, for the daily code budget.
 * A stub until ticket #23 gives it behaviour.
 */
export class GlobalGate extends DurableObject<Env> {
  override fetch(): Response {
    return notImplemented("GlobalGate");
  }
}
