import { GITHUB_ACCEPT, GITHUB_API_VERSION, WORKER_USER_AGENT } from "@shared/github/constants.ts";
import type { StaffMeta } from "@shared/staff/session.ts";
import { signAppJwt } from "./app-jwt.ts";
import { createBotClient, type BotClientEnv } from "./bot-client.ts";

/**
 * The Bot's GitHub identity as the Staff dashboard needs it to attribute Reporter comments (SPEC 4.3): the App's
 * `slug` from `GET /app` (a JWT call) gives the login `<slug>[bot]`; the account's numeric id and type come from
 * `GET /users/<login>`. Cached per isolate: the identity never changes while the App exists.
 */
const CACHE_MS = 10 * 60_000;
let cached: { key: string; expiresAt: number; identity: StaffMeta["bot"] } | null = null;

export async function resolveBotIdentity(
  env: BotClientEnv & { BOT_USER_ID?: string; BOT_LOGIN?: string },
): Promise<StaffMeta["bot"]> {
  // Live Deployments pin the verified identity; the local world discovers its throwaway Bot instead.
  if (env.BOT_USER_ID || env.BOT_LOGIN) {
    const id = Number(env.BOT_USER_ID);
    if (
      !env.BOT_USER_ID ||
      !env.BOT_LOGIN ||
      !Number.isSafeInteger(id) ||
      id <= 0 ||
      !env.BOT_LOGIN.endsWith("[bot]")
    ) {
      throw new Error("Invalid pinned Bot identity");
    }
    return { id, login: env.BOT_LOGIN, type: "Bot" };
  }
  const key = `${env.GITHUB_API_BASE}|${env.BOT_APP_ID}`;
  if (cached && cached.key === key && cached.expiresAt > Date.now()) return cached.identity;

  const base = env.GITHUB_API_BASE.replace(/\/+$/, "");
  const jwt = await signAppJwt(env.BOT_APP_PRIVATE_KEY, env.BOT_APP_ID);
  const app = await fetch(`${base}/app`, {
    headers: {
      authorization: `Bearer ${jwt}`,
      accept: GITHUB_ACCEPT,
      "user-agent": WORKER_USER_AGENT,
      "x-github-api-version": GITHUB_API_VERSION,
    },
    signal: AbortSignal.timeout(10_000),
  });
  if (!app.ok) throw new Error(`GET /app answered ${app.status}`);
  const { slug } = await app.json<{ slug: string }>();
  const login = `${slug}[bot]`;
  const account = await createBotClient(env).request<{ id: number; type: string }>(
    "GET",
    `/users/${encodeURIComponent(login)}`,
  );
  if (account.data.type !== "Bot") throw new Error(`${login} is not a Bot account`);
  const identity = { login, id: account.data.id, type: "Bot" as const };
  cached = { key, expiresAt: Date.now() + CACHE_MS, identity };
  return identity;
}
