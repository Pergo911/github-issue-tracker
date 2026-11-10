/**
 * The fixed Deployment values every test world uses, so the fakes' tests, the Worker's variables in Worker
 * tests and the end-to-end suite agree. Plain constants: `vitest.config.ts` imports this file.
 */
export const TEST_ORG = "fake-org";
export const TEST_REPO = "reports";
export const TEST_ORIGIN = "https://world.test";
export const TEST_WEBHOOK_SECRET = "test-webhook-secret";
export const TEST_STAFF_CLIENT_ID = "Iv1.teststaffclient";

export const TEST_BOT = {
  appId: 424242,
  clientId: "Iv23litestbotclient",
  slug: "fault-reports-bot",
  installationId: 777001,
} as const;

/** The secret the recorded real deliveries under `fixtures/github-webhooks/` are signed with. */
export const FIXTURE_WEBHOOK_SECRET = "contract-fixture-secret";
