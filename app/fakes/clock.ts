/**
 * The world's clock: real time plus an offset tests can advance. Token expiry, device-code expiry, the Resend
 * idempotency window and every timestamp the fakes write use it, so "an hour later" is one call. JWT
 * `iat`/`exp` checks use the real clock instead: the Worker signs them with its own.
 */
export interface Clock {
  now(): number;
  advance(milliseconds: number): void;
  reset(): void;
}

export function createClock(base: () => number = Date.now): Clock {
  let offset = 0;
  return {
    now: () => base() + offset,
    advance: (milliseconds) => {
      offset += milliseconds;
    },
    reset: () => {
      offset = 0;
    },
  };
}
