/**
 * The two local servers every end-to-end run starts, each with its own state (SPEC 2.6, ticket #21):
 *   seeded  the Appendix A configuration is in local KV, as on the reference Deployment
 *   empty   no `config` key: a fresh Deployment, which shows the "not configured" screen
 * `scripts/e2e.ts` (and `scripts/visual.ts`, `scripts/screenshots.ts`) pick free ports and a private state
 * directory per run and pass them in the environment, so runs in sibling worktrees never collide.
 */
export type ServerKind = "seeded" | "empty";

export const SERVER_KINDS: readonly ServerKind[] = ["seeded", "empty"];

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
