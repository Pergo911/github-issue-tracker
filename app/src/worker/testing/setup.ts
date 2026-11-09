import { runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, beforeAll, beforeEach, expect, vi } from "vitest";
import { TEST_ORIGIN } from "@fakes/testing/constants.ts";
import { fakeWorld } from "./world.ts";

// Runs before every Worker test file (vitest.config.ts `setupFiles`). Ticket #22: the fake GitHub and the
// fake Resend answer the Worker's outbound `fetch`, and the shared invariant check runs after every test.

beforeAll(() => {
  const world = fakeWorld();
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    if (new URL(request.url).origin === TEST_ORIGIN) return world.handle(request);
    // The Worker tests never reach a real service: a base URL that was not pointed at the fakes is a bug.
    return Promise.reject(
      new TypeError(`Worker tests have no network: unexpected outbound request to ${request.url}`),
    );
  });
});

beforeEach(async () => {
  fakeWorld().control.reset();
  // The Deployment-wide code budget is one object for the whole file: every test starts with a full day.
  await runInDurableObject(env.GLOBAL_GATE.getByName("deployment"), (_gate, state) =>
    state.storage.deleteAll(),
  );
});

afterEach(async () => {
  const world = fakeWorld();
  // Every Allowlist entry in KV is an address that must never reach GitHub (SPEC 4.1, 5), however the test
  // added it. Registering it checks the writes made so far as well.
  const listed = await env.KV.list({ prefix: "allowlist:" });
  for (const { name } of listed.keys) world.control.protectEmail(name.slice("allowlist:".length));
  await world.control.flushWebhooks();
  expect(
    world.control.takeViolations(),
    "an Allowlist email address was written to GitHub (SPEC 4.1, 5): a Report must never carry it",
  ).toEqual([]);
});
