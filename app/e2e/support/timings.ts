/**
 * The waits a journey allows a machine that is also running other worktrees (SPEC 2.6 on parallel runs).
 *
 * `playwright.config.ts` sets a 10 s default; these are the two places that need more, and they live here so
 * "this machine is slower than the last one" is one edit. The same `SLOW` had been copied into four screen
 * modules, which is how it drifted from the default in the first place.
 */

/**
 * A screen that has to wait for the Worker, a route chunk and a query before it renders. The first visit to
 * `/staff` makes the dev server transform the whole staff chunk, which on a busy machine takes longer than
 * Playwright's default 10 s.
 */
export const SLOW = { timeout: 30_000 };

/** Signing in: a device-code exchange and two page loads, so it gets its own budget. */
export const SLOW_SIGN_IN = { timeout: 25_000 };
