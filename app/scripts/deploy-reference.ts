// Provision the reference Deployment without printing credentials. See docs/runbook-deployment.md.
import { execFileSync, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { parseDevVars } from "../fakes/node/local-world.ts";
import { endpoints } from "../src/shared/api/endpoints.ts";
import { referenceConfig } from "../src/shared/seed/reference-config.ts";

const directory =
  process.env["REPORTS_DEPLOYMENT_DIR"] ??
  join(homedir(), ".config", "github-issue-tracker-deployment");
const root = resolve(import.meta.dirname, "..");
const appUrl = process.env["APP_URL"] ?? "https://fault-reports.berautoapp.workers.dev";
const repo = process.env["GITHUB_REPOSITORY"] ?? "Tarsashaz-demo/reports";
const command = process.argv[2];

function wrangler(args: string[], input?: string): void {
  const result = spawnSync(process.execPath, ["node_modules/wrangler/bin/wrangler.js", ...args], {
    cwd: root,
    input,
    stdio: ["pipe", "inherit", "inherit"],
  });
  if (result.status !== 0) throw new Error(`Wrangler ${args[0]} failed`);
}

async function main() {
  if (command === "secrets") {
    const secrets = parseDevVars(readFileSync(join(directory, "secrets.env"), "utf8"));
    if (!secrets["RESEND_API_KEY"]) throw new Error("RESEND_API_KEY is missing");
    const path = join(directory, "webhook-secret.txt");
    // Keep the same secret when re-running; rotate it explicitly in both places when necessary.
    if (!existsSync(path)) writeFileSync(path, randomBytes(32).toString("hex"), { mode: 0o600 });
    wrangler(
      ["secret", "bulk"],
      JSON.stringify({
        RESEND_API_KEY: secrets["RESEND_API_KEY"],
        BOT_APP_PRIVATE_KEY: readFileSync(join(directory, "bot-private-key.pem"), "utf8"),
        GITHUB_WEBHOOK_SECRET: readFileSync(path, "utf8").trim(),
      }),
    );
  } else if (command === "webhook") {
    const hooks = JSON.parse(
      execFileSync("gh", ["api", `repos/${repo}/hooks`], { encoding: "utf8" }),
    ) as { id: number; config: { url: string } }[];
    const url = `${appUrl}/api/github/webhook`;
    const existing = hooks.find((hook) => hook.config.url === url);
    const body = JSON.stringify({
      name: "web",
      active: true,
      events: ["issues"],
      config: {
        url,
        content_type: "json",
        insecure_ssl: "0",
        secret: readFileSync(join(directory, "webhook-secret.txt"), "utf8").trim(),
      },
    });
    const result = JSON.parse(
      execFileSync(
        "gh",
        [
          "api",
          "--method",
          existing ? "PATCH" : "POST",
          `repos/${repo}/hooks${existing ? `/${existing.id}` : ""}`,
          "--input",
          "-",
        ],
        { input: body, encoding: "utf8" },
      ),
    ) as { id: number };
    execFileSync("gh", ["api", "--method", "POST", `repos/${repo}/hooks/${result.id}/pings`], {
      stdio: "ignore",
    });
    let pingCode: number | null = null;
    for (let attempt = 0; attempt < 10; attempt++) {
      await delay(2_000);
      const hook = JSON.parse(
        execFileSync("gh", ["api", `repos/${repo}/hooks/${result.id}`], { encoding: "utf8" }),
      ) as { last_response?: { code?: number | null } };
      pingCode = hook.last_response?.code ?? null;
      if (pingCode !== null && pingCode >= 200 && pingCode < 300) break;
    }
    if (pingCode === null || pingCode < 200 || pingCode >= 300) {
      throw new Error(`Webhook ${result.id} ping did not succeed (last_response.code=${pingCode})`);
    }
    console.log(`Webhook ${result.id} configured for issues only; ping answered HTTP ${pingCode}.`);
  } else if (command === "configure") {
    const token =
      process.env["GITHUB_TOKEN"] ??
      process.env["GH_TOKEN"] ??
      execFileSync("gh", ["auth", "token"], { encoding: "utf8" }).trim();
    const config = {
      ...referenceConfig,
      email: {
        ...referenceConfig.email,
        replyTo: process.env["REPLY_TO"] ?? "reply@mail.berautoapp.hu",
      },
    };
    const response = await fetch(`${appUrl}${endpoints.configSave.path}`, {
      method: endpoints.configSave.method,
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ config }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!response.ok) throw new Error(`Configuration save answered HTTP ${response.status}`);
    const result = (await response.json()) as { sync: { created: string[]; recoloured: string[] } };
    console.log(
      `Hungarian configuration saved; labels created: ${result.sync.created.length}, recoloured: ${result.sync.recoloured.length}.`,
    );
  } else {
    throw new Error(
      "Usage: node scripts/deploy-reference.ts <secrets|webhook|configure>. configure replaces the whole configuration with Appendix A; use only for initial setup.",
    );
  }
}

await main().catch((error: unknown) => {
  // Child-process exceptions can contain stdin (secrets): never dump their properties or stack.
  console.error(
    error instanceof Error && !("stderr" in error)
      ? error.message
      : "Deployment command failed; credentials were not printed.",
  );
  process.exitCode = 1;
});
