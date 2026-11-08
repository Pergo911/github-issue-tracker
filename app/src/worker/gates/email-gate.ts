import { DurableObject } from "cloudflare:workers";
import { notImplemented } from "./stub.ts";

/**
 * Email gate, one per SHA-256 of a normalized email (SPEC 4.5, 5): the OTP, its caps, the pending
 * submission and its recovery state. A stub until ticket #23 gives it behaviour.
 */
export class EmailGate extends DurableObject<Env> {
  override fetch(): Response {
    return notImplemented("EmailGate");
  }
}
