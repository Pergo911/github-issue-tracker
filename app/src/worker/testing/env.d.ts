/** Bindings only the Worker tests have (vitest.config.ts). */
interface Env {
  /** SPKI PEM of the throwaway Bot key: the fake GitHub verifies App JWTs with it. */
  TEST_BOT_PUBLIC_KEY: string;
}
