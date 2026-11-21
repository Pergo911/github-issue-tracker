/**
 * The two local servers every end-to-end run starts, each with its own state (SPEC 2.6, ticket #21):
 *   seeded  the Appendix A configuration is in local KV, as on the reference Deployment
 *   empty   no `config` key: a fresh Deployment, which shows the "not configured" screen
 *   setup   also empty at the start, and the one a journey may configure: the Configuration journeys (ticket #30)
 *           save to it, so nothing else may rely on its state. Never read it from a declared screen.
 * `scripts/e2e.ts` (and `scripts/visual.ts`, `scripts/screenshots.ts`) pick free ports and a private state
 * directory per run and pass them in the environment, so runs in sibling worktrees never collide.
 */
export type ServerKind = "seeded" | "empty" | "setup";

export const SERVER_KINDS: readonly ServerKind[] = ["seeded", "empty", "setup"];

/**
 * Which local servers this run started (`E2E_SERVERS`, comma-separated). Defaults to all three when unset;
 * `test:visual` and `screenshots` omit `setup` because no declared screen may read it.
 */
export function activeServerKinds(
  environment: NodeJS.ProcessEnv = process.env,
): readonly ServerKind[] {
  const raw = environment["E2E_SERVERS"]?.trim();
  if (!raw) return SERVER_KINDS;
  const kinds: ServerKind[] = [];
  for (const part of raw
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)) {
    if (!SERVER_KINDS.includes(part as ServerKind)) {
      throw new Error(
        `Unknown server kind "${part}" in E2E_SERVERS (expected: ${SERVER_KINDS.join(", ")})`,
      );
    }
    kinds.push(part as ServerKind);
  }
  return kinds.length > 0 ? kinds : SERVER_KINDS;
}

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `${name} is not set. Run the end-to-end tests through "npm run test:e2e" (or "npm run screenshots", ` +
        `"npm run test:visual"): those pick free ports and a private state directory for the run.`,
    );
  }
  return value;
}

export function serverPort(kind: ServerKind): number {
  return Number(requiredEnvironment(`E2E_PORT_${kind.toUpperCase()}`));
}

/** The port the server's local world (fake GitHub, fake Resend, control API) listens on. */
export function fakesPort(kind: ServerKind): number {
  return Number(requiredEnvironment(`E2E_FAKES_PORT_${kind.toUpperCase()}`));
}

/** The control API of a server's local world: `remoteControl(controlUrl(kind))`. */
export function controlUrl(kind: ServerKind): string {
  return `http://127.0.0.1:${fakesPort(kind)}/control`;
}

export function serverOrigin(kind: ServerKind): string {
  return `http://127.0.0.1:${serverPort(kind)}`;
}

/** The absolute URL of a path on one of the run's servers. */
export function urlFor(kind: ServerKind, path: string): string {
  return `${serverOrigin(kind)}${path}`;
}

export function runDirectory(): string {
  return requiredEnvironment("E2E_RUN_DIR");
}
