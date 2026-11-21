import { createPublicKey } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { join, resolve } from "node:path";
import type { AddressInfo } from "node:net";
import type { Plugin } from "vite";
import { generateAppKeyPair } from "../keys.ts";
import { createWorld } from "../world.ts";
import { startBridge, type Bridge } from "./bridge.ts";

/**
 * The local world (ticket #22): `vite dev` hosts the fake GitHub and the fake Resend, points the Worker's
 * variables and the SPA's GitHub base at them, and leaves nothing running when it stops. Nothing here runs in
 * `vite build`, so production behaviour is unchanged.
 *
 *   FAKES_PORT   the port the fakes listen on (loopback). Unset: a free one, so sibling worktrees never collide.
 *   PERSIST_DIR  where `world.json` (how `npm run world` finds the running world) is written, next to local KV.
 */

export const LOCAL_ORG = "local-org";
export const LOCAL_REPO = "reports";
export const LOCAL_BOT = {
  appId: 424242,
  clientId: "Iv23liLocalBotClient",
  slug: "fault-reports-bot",
  installationId: 777001,
} as const;
export const LOCAL_STAFF_CLIENT_ID = "Iv1.localstaffclient";
export const LOCAL_FROM_DOMAIN = "mail.berautoapp.hu";

export interface LocalWorldPlan {
  fakesPort: number;
  /** Worker variables that point at the fakes (merged over wrangler.jsonc's `vars`). */
  vars: Record<string, string>;
  /** The SPA's GitHub API base, as a build-time value. */
  githubApiBase: string;
  botPublicKey: string;
  webhookSecret: string;
  stateDirectory: string;
}

/** `KEY=value` lines of a `.dev.vars` file, with `\n` escapes in quoted values restored (dotenv style). */
export function parseDevVars(text: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (!match || line.trimStart().startsWith("#")) continue;
    let value = match[2] as string;
    if (/^(".*"|'.*')$/.test(value)) {
      const quote = value[0];
      value = value.slice(1, -1);
      if (quote === '"') value = value.replaceAll(String.raw`\n`, "\n");
    }
    values[match[1] as string] = value;
  }
  return values;
}

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((done, fail) => {
    server.once("error", fail);
    server.listen(0, "127.0.0.1", done);
  });
  const { port } = server.address() as AddressInfo;
  await new Promise((done) => server.close(done));
  return port;
}

export async function planLocalWorld(
  root: string,
  environment: NodeJS.ProcessEnv = process.env,
): Promise<LocalWorldPlan> {
  const devVarsPath = join(root, ".dev.vars");
  // Wrangler prefers `.dev.vars` over the process environment, so does the plan.
  const devVars = existsSync(devVarsPath) ? parseDevVars(readFileSync(devVarsPath, "utf8")) : {};
  const setting = (name: string) => devVars[name] ?? environment[name];

  let privateKey = setting("BOT_APP_PRIVATE_KEY");
  let generatedKey: string | undefined;
  if (privateKey === undefined || privateKey === "") {
    // No key configured: make a throwaway one for this process. Nothing is written to disk.
    privateKey = (await generateAppKeyPair()).privateKeyPkcs1;
    generatedKey = privateKey;
    // Wrangler reads secrets from the environment only when there is no .dev.vars: the variable below covers that case.
    environment["BOT_APP_PRIVATE_KEY"] = privateKey;
  } else if (!privateKey.includes("-----BEGIN")) {
    console.warn(
      "Local world: BOT_APP_PRIVATE_KEY is set but is not a PEM key, so the Bot cannot sign in to the fake " +
        "GitHub. Remove it from .dev.vars (the dev server then generates a throwaway key).",
    );
  }
  let botPublicKey = "";
  try {
    botPublicKey = createPublicKey(privateKey.replaceAll(String.raw`\n`, "\n"))
      .export({ type: "spki", format: "pem" })
      .toString();
  } catch {
    // The warning above explains; the fake then rejects every App JWT.
  }

  const fakesPort = environment["FAKES_PORT"]
    ? Number(environment["FAKES_PORT"])
    : await freePort();
  const base = `http://127.0.0.1:${fakesPort}`;
  return {
    fakesPort,
    botPublicKey,
    webhookSecret: setting("GITHUB_WEBHOOK_SECRET") ?? "local-development-webhook-secret",
    githubApiBase: `${base}/github`,
    stateDirectory: resolve(root, environment["PERSIST_DIR"] ?? ".wrangler/state"),
    vars: {
      GITHUB_API_BASE: `${base}/github`,
      GITHUB_WEB_BASE: `${base}/github-web`,
      RESEND_API_BASE: `${base}/resend`,
      GITHUB_ORG: LOCAL_ORG,
      GITHUB_REPO: LOCAL_REPO,
      BOT_APP_ID: String(LOCAL_BOT.appId),
      BOT_INSTALLATION_ID: String(LOCAL_BOT.installationId),
      BOT_USER_ID: "",
      BOT_LOGIN: "",
      STAFF_APP_CLIENT_ID: LOCAL_STAFF_CLIENT_ID,
      // Switches on the dev-only smoke routes (src/worker/dev/): they do not exist in production.
      LOCAL_WORLD: "1",
      ...(generatedKey ? { BOT_APP_PRIVATE_KEY: generatedKey } : {}),
    },
  };
}

/** What `npm run world` and the end-to-end suite read to find a running world. */
export interface WorldDescriptor {
  url: string;
  control: string;
  github: string;
  githubWeb: string;
  resend: string;
  pid: number;
}

export function worldFile(stateDirectory: string): string {
  return join(stateDirectory, "world.json");
}

export function localWorldPlugin(plan: LocalWorldPlan): Plugin {
  let bridge: Bridge | undefined;
  return {
    name: "local-world",
    apply: "serve",
    // Pass this server's fake GitHub base to the SPA via HTML metadata rather than Vite's `define`, so Vite's
    // dependency pre-bundling hash stays identical across per-run ports and parallel servers.
    transformIndexHtml() {
      return [
        {
          tag: "meta",
          attrs: { name: "local-world-github-api-base", content: plan.githubApiBase },
          injectTo: "head",
        },
      ];
    },
    async configureServer(server) {
      const world = createWorld({
        org: LOCAL_ORG,
        repo: LOCAL_REPO,
        bot: { ...LOCAL_BOT, publicKey: plan.botPublicKey },
        staffClientId: LOCAL_STAFF_CLIENT_ID,
        verifiedDomains: [process.env["RESEND_FROM_DOMAIN"] ?? LOCAL_FROM_DOMAIN],
      });
      bridge = await startBridge(world, plan.fakesPort);
      const descriptor: WorldDescriptor = {
        url: bridge.url,
        control: `${bridge.url}/control`,
        github: `${bridge.url}/github`,
        githubWeb: `${bridge.url}/github-web`,
        resend: `${bridge.url}/resend`,
        pid: process.pid,
      };
      mkdirSync(plan.stateDirectory, { recursive: true });
      writeFileSync(worldFile(plan.stateDirectory), `${JSON.stringify(descriptor, null, 2)}\n`);

      // Webhooks go to the Worker through the dev server itself, once its address is known.
      server.httpServer?.once("listening", () => {
        const address = server.httpServer?.address();
        if (address === null || address === undefined || typeof address === "string") return;
        const host = address.family === "IPv6" ? `[${address.address}]` : address.address;
        world.setWebhookTarget({
          url: `http://${host}:${address.port}/api/github/webhook`,
          secret: plan.webhookSecret,
          deliver: (request) => fetch(request),
        });
        server.config.logger.info(
          `  Local world: fake GitHub and Resend on ${descriptor.url} (npm run world -- summary)`,
        );
      });
      server.httpServer?.once("close", () => {
        void bridge?.close();
        rmSync(worldFile(plan.stateDirectory), { force: true });
      });
    },
  };
}
