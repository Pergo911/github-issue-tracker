import { expect } from "@playwright/test";
import type { AsyncControl } from "../../fakes/control.ts";
import type { SentMail } from "../../fakes/resend/resend.ts";

/**
 * How long a journey waits for the local world's outbox, in milliseconds.
 *
 * The mail is written by the Worker beside the fake that holds it, so an empty outbox is a real failure — but a
 * starved machine can spend several seconds before the Worker's request is even dispatched. This one number is
 * the whole allowance: the same 15 s had been copied into four specs, and gave up once at 17:35 on a loaded box
 * while the mail was still on its way. A slower machine is one edit here, not four.
 */
export const MAIL_TIMEOUT = 30_000;

/** The mail the local world has sent to `email`, once at least `count` of them have arrived. */
export async function waitForMails(
  world: AsyncControl,
  email: string,
  count = 1,
): Promise<SentMail[]> {
  await expect
    .poll(async () => (await world.outbox(email)).length, { timeout: MAIL_TIMEOUT })
    .toBeGreaterThanOrEqual(count);
  return world.outbox(email);
}

/** The six-digit code from the newest mail to `email`: what the Submission form's second step asks for. */
export async function codeFromMailbox(world: AsyncControl, email: string): Promise<string> {
  const mails = await waitForMails(world, email, 1);
  const code = /\b(\d{6})\b/.exec(mails.at(-1)?.text ?? "")?.[1];
  expect(code, `no six-digit code in the newest mail to ${email}`).toBeTruthy();
  return code as string;
}
