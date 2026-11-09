import { execFileSync } from "node:child_process";
import { endpoints } from "../../src/shared/api/endpoints.ts";
import type { RecoveryDetail, RecoveryEntry } from "../../src/shared/reports/recovery.ts";

/**
 * The operator procedure for submissions that need a person (SPEC 4.1, docs/runbook-submission-recovery.md): a thin
 * client over the Admin-gated `/api/admin/recovery/*` endpoints, called with the operator's own GitHub token.
 * Everything a command prints goes through `log`, and the network through `fetcher`, so the tests drive it whole.
 */
export interface RecoveryCliDeps {
  fetcher?: typeof fetch;
  log?: (line: string) => void;
  /** The operator's GitHub token when `--token` and `GITHUB_TOKEN` are absent (default: `gh auth token`). */
  ghToken?: () => string;
  environment?: Record<string, string | undefined>;
}

export const USAGE = `Usage:
  node scripts/recovery.ts list                                    --url <app url>
  node scripts/recovery.ts inspect   (--reference ABCD-1234 | --email <address>)   --url <app url>
  node scripts/recovery.ts associate (--reference ABCD-1234 | --email <address>) --issue <number>   --url <app url>
  node scripts/recovery.ts discard   (--reference ABCD-1234 | --email <address>)   --url <app url>

--url defaults to APP_URL. The token is --token, else GITHUB_TOKEN, else \`gh auth token\` (an Admin of the repository).`;

interface Parsed {
  command: string;
  options: Map<string, string>;
}

function parse(argv: readonly string[]): Parsed {
  const [command, ...rest] = argv;
  if (!command) throw new Error(USAGE);
  const options = new Map<string, string>();
  for (let index = 0; index < rest.length; index++) {
    const flag = rest[index] as string;
    if (!flag.startsWith("--")) throw new Error(`Unexpected "${flag}".\n${USAGE}`);
    const value = rest[index + 1];
    if (value === undefined || value.startsWith("--")) throw new Error(`${flag} needs a value.`);
    options.set(flag.slice(2), value);
    index++;
  }
  return { command, options };
}

function defaultGhToken(): string {
  return execFileSync("gh", ["auth", "token"], { encoding: "utf8" }).trim();
}

export async function runRecovery(argv: readonly string[], deps: RecoveryCliDeps = {}) {
  const log = deps.log ?? ((line: string) => console.log(line));
  const fetcher =
    deps.fetcher ?? ((input: string | URL | Request, init?: RequestInit) => fetch(input, init));
  const environment = deps.environment ?? process.env;
  const { command, options } = parse(argv);

  const base = (options.get("url") ?? environment["APP_URL"] ?? "").replace(/\/+$/, "");
  if (!base) throw new Error(`No app URL: pass --url or set APP_URL.\n${USAGE}`);
  const token =
    options.get("token") ?? environment["GITHUB_TOKEN"] ?? (deps.ghToken ?? defaultGhToken)();

  async function call<T>(
    endpoint: { method: string; path: string },
    input: Record<string, unknown> = {},
  ): Promise<T> {
    const query = new URLSearchParams();
    const get = endpoint.method === "GET";
    if (get) for (const [key, value] of Object.entries(input)) query.set(key, String(value));
    const response = await fetcher(
      `${base}${endpoint.path}${get && query.size ? `?${query}` : ""}`,
      {
        method: endpoint.method,
        headers: {
          authorization: `Bearer ${token}`,
          accept: "application/json",
          ...(get ? {} : { "content-type": "application/json" }),
        },
        ...(get ? {} : { body: JSON.stringify(input) }),
      },
    );
    const body = (await response.json().catch(() => null)) as {
      error?: { code?: string };
    } | null;
    if (!response.ok) {
      throw new Error(`${command} failed: ${body?.error?.code ?? "http_" + response.status}`);
    }
    return body as T;
  }

  const selector = (): Record<string, string> => {
    const reference = options.get("reference");
    const email = options.get("email");
    if ((reference === undefined) === (email === undefined)) {
      throw new Error(`Give --reference or --email, not both.\n${USAGE}`);
    }
    return reference === undefined ? { email: email as string } : { reference };
  };

  switch (command) {
    case "list": {
      const { attempts } = await call<{ attempts: RecoveryEntry[] }>(endpoints.recoveryList);
      if (attempts.length === 0) log("No attempt needs a person.");
      for (const attempt of attempts) {
        log(
          `${attempt.reference}  ${attempt.phase}  since ${new Date(attempt.since).toISOString()}`,
        );
      }
      return;
    }
    case "inspect": {
      const detail = await call<RecoveryDetail>(endpoints.recoveryInspect, selector());
      log(`Reference:  ${detail.reference}`);
      log(`Address:    ${detail.email}`);
      log(`Phase:      ${detail.phase}`);
      log(`Issue:      ${detail.issueNumber === null ? "none known" : `#${detail.issueNumber}`}`);
      log(`Title:      ${detail.title}`);
      log(`Category:   ${detail.category}, location ${detail.location}`);
      log(`Started:    ${new Date(detail.startedAt).toISOString()}`);
      log(`Marker:     ${detail.markerLine}`);
      log(
        detail.matches === null
          ? "Scan:       GitHub could not be asked just now."
          : `Scan:       ${detail.matches.length === 0 ? "no issue carries the marker" : `issues ${detail.matches.map((n) => `#${n}`).join(", ")}`}`,
      );
      return;
    }
    case "associate": {
      const issue = Number(options.get("issue"));
      if (!Number.isInteger(issue) || issue <= 0)
        throw new Error(`--issue needs an issue number.\n${USAGE}`);
      const result = await call<{ outcome: string; number: number }>(endpoints.recoveryAssociate, {
        ...selector(),
        issueNumber: issue,
      });
      log(
        result.outcome === "complete"
          ? `Issue #${result.number} is linked and its mappings are written.`
          : `Issue #${result.number} is linked; finishing its mappings is still in progress (run inspect again).`,
      );
      return;
    }
    case "discard": {
      await call(endpoints.recoveryDiscard, selector());
      log("The attempt and its partial mappings were discarded.");
      return;
    }
    default:
      throw new Error(`Unknown command "${command}".\n${USAGE}`);
  }
}
