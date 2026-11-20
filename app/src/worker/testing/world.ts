import { env, exports } from "cloudflare:workers";
import { createWorld, type World } from "@fakes/world.ts";
import {
  TEST_BOT,
  TEST_ORG,
  TEST_ORIGIN,
  TEST_REPO,
  TEST_WEBHOOK_SECRET,
} from "@fakes/testing/constants.ts";
import { httpClient } from "@fakes/testing/api.ts";

/** Where the fake GitHub's webhooks are delivered: the Worker under test, by its real entry point. */
export const WEBHOOK_URL = "https://reports.test/api/github/webhook";

let world: World | undefined;

/**
 * The fake GitHub and fake Resend of this test file, running in the same Workers isolate as the Worker
 * (so the Worker's outbound `fetch` reaches them: see setup.ts). One per test file; `setup.ts` resets it
 * before every test.
 */
export function fakeWorld(): World {
  world ??= createWorld({
    org: TEST_ORG,
    repo: TEST_REPO,
    bot: { ...TEST_BOT, publicKey: env.TEST_BOT_PUBLIC_KEY },
    staffClientId: env.STAFF_APP_CLIENT_ID,
    webhook: {
      url: WEBHOOK_URL,
      secret: TEST_WEBHOOK_SECRET,
      deliver: (request) => exports.default.fetch(request),
    },
  });
  return world;
}

/** A client over the world's wire protocols, for assertions that read what the Worker did to GitHub. */
export function fakeClient() {
  return httpClient(fakeWorld(), TEST_ORIGIN);
}

/**
 * Adds an Allowlist entry the way the Worker keeps it (SPEC 5) and registers the address with the invariant
 * check: any write to the fake GitHub carrying it fails the test. `setup.ts` also registers every `allowlist:`
 * key in KV when a test ends, so a test that adds entries some other way is covered too.
 */
export async function addToAllowlist(email: string, note?: string): Promise<void> {
  const normalised = email.trim().toLowerCase();
  await env.KV.put(
    `allowlist:${normalised}`,
    JSON.stringify({
      ...(note ? { note } : {}),
      addedBy: "test",
      addedAt: new Date().toISOString(),
    }),
  );
  fakeWorld().control.protectEmail(normalised);
}
