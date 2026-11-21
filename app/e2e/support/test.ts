import { expect, test as base } from "@playwright/test";
import { remoteControl, type AsyncControl } from "../../fakes/control.ts";
import { activeServerKinds, controlUrl, type ServerKind } from "./servers.ts";

/** The control API of one server's local world (its fake GitHub, fake Resend and clock). */
export function worldOf(kind: ServerKind): AsyncControl {
  return remoteControl(controlUrl(kind));
}

/**
 * Playwright's `test`, with the shared invariant check of ticket #22 wired into the lifecycle: after every test, a
 * write to either server's fake GitHub that carried a protected (Allowlist) email address fails it. Import `test`
 * from here, not from `@playwright/test`, so every end-to-end test gets the check for free. A test that adds an
 * Allowlist entry registers the address with `world.protectEmail(address)`.
 *
 * Tests of one run share their server's world: do not call `reset` in a test (it would break the others);
 * name your own data (labels, addresses) instead.
 */
export const test = base.extend<{ world: AsyncControl; invariants: undefined }>({
  /** The seeded server's world: the one most journeys use. */
  // eslint-disable-next-line no-empty-pattern -- Playwright fixtures must destructure their first argument
  world: async ({}, use) => {
    await use(worldOf("seeded"));
  },
  invariants: [
    // eslint-disable-next-line no-empty-pattern -- Playwright fixtures must destructure their first argument
    async ({}, use) => {
      await use(undefined);
      for (const kind of activeServerKinds()) {
        const violations = await worldOf(kind).takeViolations();
        expect(
          violations,
          `an Allowlist email address was written to GitHub on the ${kind} server (SPEC 4.1, 5)`,
        ).toEqual([]);
      }
    },
    { auto: true },
  ],
});

export { expect };
