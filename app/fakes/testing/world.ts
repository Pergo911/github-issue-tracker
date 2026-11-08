import { generateAppKeyPair, type AppKeyPair } from "../keys.ts";
import { createWorld, type World, type WorldOptions } from "../world.ts";
import { httpClient, worldUrls } from "./api.ts";

/** The fixed Deployment values every test world uses, so tests and Worker variables agree. */
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

let sharedKeys: Promise<AppKeyPair> | undefined;

/** One RSA key pair per module instance (that is, per test file): generating one costs about 100 ms. */
export function testKeys(): Promise<AppKeyPair> {
  sharedKeys ??= generateAppKeyPair();
  return sharedKeys;
}

export interface TestWorld {
  world: World;
  control: World["control"];
  client: ReturnType<typeof httpClient>;
  keys: AppKeyPair;
  bot: typeof TEST_BOT;
  org: string;
  repo: string;
  origin: string;
  urls: ReturnType<typeof worldUrls>;
}

/** A fresh in-process world: `world.handle` is the whole HTTP surface, `client` speaks it. */
export async function createTestWorld(overrides: Partial<WorldOptions> = {}): Promise<TestWorld> {
  const keys = await testKeys();
  const world = createWorld({
    org: TEST_ORG,
    repo: TEST_REPO,
    bot: { ...TEST_BOT, publicKey: keys.publicKey },
    staffClientId: TEST_STAFF_CLIENT_ID,
    ...overrides,
  });
  return {
    world,
    control: world.control,
    client: httpClient(world, TEST_ORIGIN),
    keys,
    bot: TEST_BOT,
    org: TEST_ORG,
    repo: TEST_REPO,
    origin: TEST_ORIGIN,
    urls: worldUrls(TEST_ORIGIN),
  };
}
