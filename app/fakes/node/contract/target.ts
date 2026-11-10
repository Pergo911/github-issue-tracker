import { createPrivateKey, createSign } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { GITHUB_ACCEPT, GITHUB_API_VERSION } from "../../../src/shared/github/constants.ts";
import { castedWorld } from "../../testing/bot.ts";
import { createTestWorld, TEST_BOT, type TestWorld } from "../../testing/world.ts";
import type { Reply } from "../../testing/api.ts";

/**
 * One interface over the two things the contract suite runs against: the in-process fake GitHub and the live
 * `reports-sandbox` repo with the real Bot. A scenario is written once, against this, so the two cannot
 * drift: a scenario that passes on the fake and fails live is a difference to fix.
 */

export interface CallOptions {
  token?: string;
  json?: unknown;
  query?: Record<string, string | number>;
  headers?: Record<string, string>;
}

export interface ContractTarget {
  kind: "fake" | "live";
  org: string;
  repo: string;
  /** The Bot App's numeric id and the installation the suite exchanges its JWT for. */
  appId: number;
  installationId: number;
  /** The staff app's client id, for the device-flow scenarios. */
  staffClientId: string;
  /** api.github.com. Sends the User-Agent, API-version and Accept headers GitHub's clients must send. */
  github(method: string, path: string, options?: CallOptions): Promise<Reply>;
  /** github.com's web endpoints (device flow), form-encoded, asking for JSON. */
  web(method: string, path: string, form: Record<string, string>): Promise<Reply>;
  /** A signed App JWT; claims default to GitHub's documented shape and can be overridden. */
  signJwt(claims?: Partial<{ iat: number; exp: number; iss: string }>): string;
  /** An installation token for the Bot. */
  botToken(): Promise<string>;
  /** A token with admin on the repo: the operator's own, or the fake's admin. */
  operatorToken(): string;
  /** `/repos/<org>/<repo><suffix>`. */
  path(suffix?: string): string;
}

/** The only repo the live half may touch. Never `reports`. */
export const SANDBOX_REPO = "reports-sandbox";

export const DEPLOYMENT_DIR =
  process.env["REPORTS_DEPLOYMENT_DIR"] ??
  join(homedir(), ".config", "github-issue-tracker-deployment");

type Claims = Partial<{ iat: number; exp: number; iss: string }>;

function signWith(privateKeyPem: string, appId: number, claims: Claims): string {
  const now = Math.floor(Date.now() / 1000);
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const input = `${encode({ alg: "RS256", typ: "JWT" })}.${encode({
    iat: now - 60,
    exp: now + 540,
    iss: String(appId),
    ...claims,
  })}`;
  const signature = createSign("RSA-SHA256").update(input).sign(createPrivateKey(privateKeyPem));
  return `${input}.${signature.toString("base64url")}`;
}

async function toReply(response: Response): Promise<Reply> {
  const text = await response.text();
  let json: unknown;
  try {
    json = text === "" ? undefined : JSON.parse(text);
  } catch {
    json = undefined;
  }
  return { status: response.status, headers: response.headers, json, text };
}

export async function fakeTarget(): Promise<ContractTarget & { world: TestWorld }> {
  const world = await createTestWorld();
  const cast = await castedWorld(world);
  return {
    kind: "fake",
    world,
    org: world.org,
    repo: world.repo,
    appId: TEST_BOT.appId,
    installationId: TEST_BOT.installationId,
    staffClientId: "Iv1.teststaffclient",
    github: (method, path, options = {}) =>
      world.client.github(method, path, {
        ...(options.token !== undefined ? { token: options.token } : {}),
        ...(options.json !== undefined ? { json: options.json } : {}),
        ...(options.query ? { query: options.query } : {}),
        ...(options.headers ? { headers: options.headers } : {}),
      }),
    web: (method, path, form) => world.client.web(method, path, { form }),
    signJwt: (claims = {}) => signWith(world.keys.privateKeyPkcs8, TEST_BOT.appId, claims),
    botToken: async () => cast.bot,
    operatorToken: () => cast.admin,
    path: (suffix = "") => `/repos/${world.org}/${world.repo}${suffix}`,
  };
}

/** What the live half needs. */
export interface LiveCredentials {
  org: string;
  appId: number;
  installationId: number;
  staffClientId: string;
  privateKey: string;
  operatorToken: string;
}

function parseEnvFile(path: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (match) values[match[1] as string] = (match[2] as string).replace(/^["']|["']$/g, "");
  }
  return values;
}

/**
 * Opt in with `CONTRACT_LIVE=1` (`npm run test:contract:live`). Reads the Bot's private key and `live.env`
 * (`GITHUB_ORG`, `BOT_APP_ID`, `BOT_INSTALLATION_ID`, `STAFF_APP_CLIENT_ID`, all non-secret) from the secrets
 * folder, and the operator's own token from `GITHUB_TOKEN`, `GH_TOKEN` or `gh auth token`. Anything missing
 * returns the reason, and the suite skips with it.
 */
export function liveCredentials(): { credentials: LiveCredentials } | { skip: string } {
  if (process.env["CONTRACT_LIVE"] !== "1") {
    return { skip: "live half is opt-in: run `npm run test:contract:live` (CONTRACT_LIVE=1)" };
  }
  const keyPath = join(DEPLOYMENT_DIR, "bot-private-key.pem");
  const envPath = join(DEPLOYMENT_DIR, "live.env");
  if (!existsSync(keyPath) || !existsSync(envPath)) {
    return { skip: `no bot-private-key.pem and live.env in ${DEPLOYMENT_DIR}` };
  }
  const env: Record<string, string | undefined> = { ...parseEnvFile(envPath), ...process.env };
  const org = env["GITHUB_ORG"];
  const appId = Number(env["BOT_APP_ID"]);
  const installationId = Number(env["BOT_INSTALLATION_ID"]);
  const staffClientId = env["STAFF_APP_CLIENT_ID"];
  if (!org || !appId || !installationId || !staffClientId) {
    return {
      skip: "live.env lacks GITHUB_ORG, BOT_APP_ID, BOT_INSTALLATION_ID or STAFF_APP_CLIENT_ID",
    };
  }
  let operatorToken = process.env["GITHUB_TOKEN"] ?? process.env["GH_TOKEN"];
  if (!operatorToken) {
    try {
      operatorToken = execFileSync("gh", ["auth", "token"], { encoding: "utf8" }).trim();
    } catch {
      return { skip: "no operator token: set GITHUB_TOKEN or log in with `gh auth login`" };
    }
  }
  return {
    credentials: {
      org,
      appId,
      installationId,
      staffClientId,
      privateKey: readFileSync(keyPath, "utf8"),
      operatorToken,
    },
  };
}

export function liveTarget(credentials: LiveCredentials): ContractTarget {
  const { org, appId, installationId, privateKey, operatorToken, staffClientId } = credentials;
  const send = async (url: URL, init: RequestInit) => {
    // The one guard: any request that names a repo names the sandbox.
    const named = /^\/repos\/[^/]+\/([^/]+)/.exec(url.pathname)?.[1];
    if (named !== undefined && named !== SANDBOX_REPO) {
      throw new Error(`The live contract suite only touches ${SANDBOX_REPO}, not ${named}`);
    }
    return toReply(await fetch(url, init));
  };
  const github: ContractTarget["github"] = (method, path, options = {}) => {
    const url = new URL(path.startsWith("http") ? path : `https://api.github.com${path}`);
    for (const [key, value] of Object.entries(options.query ?? {})) {
      url.searchParams.set(key, String(value));
    }
    const headers: Record<string, string> = {
      accept: GITHUB_ACCEPT,
      "x-github-api-version": GITHUB_API_VERSION,
      "user-agent": "reports-contract-suite",
      ...(options.token !== undefined ? { authorization: `Bearer ${options.token}` } : {}),
      ...(options.json !== undefined ? { "content-type": "application/json" } : {}),
      ...options.headers,
    };
    return send(url, {
      method,
      headers,
      ...(options.json !== undefined ? { body: JSON.stringify(options.json) } : {}),
    });
  };
  return {
    kind: "live",
    org,
    repo: SANDBOX_REPO,
    appId,
    installationId,
    staffClientId,
    github,
    web: (method, path, form) =>
      send(new URL(`https://github.com${path}`), {
        method,
        headers: {
          accept: "application/json",
          "content-type": "application/x-www-form-urlencoded",
          "user-agent": "reports-contract-suite",
        },
        body: new URLSearchParams(form).toString(),
      }),
    signJwt: (claims = {}) => signWith(privateKey, appId, claims),
    botToken: async () => {
      const reply = await github("POST", `/app/installations/${installationId}/access_tokens`, {
        token: signWith(privateKey, appId, {}),
      });
      if (reply.status !== 201)
        throw new Error(`installation token exchange failed: ${reply.text}`);
      return reply.json.token as string;
    },
    operatorToken: () => operatorToken,
    path: (suffix = "") => `/repos/${org}/${SANDBOX_REPO}${suffix}`,
  };
}
