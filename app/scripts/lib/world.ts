import { existsSync, readFileSync } from "node:fs";
import { remoteControl, type AsyncControl } from "../../fakes/control.ts";
import { worldFile, type WorldDescriptor } from "../../fakes/node/local-world.ts";
import { persistDirectory } from "./state.ts";

/**
 * Finds the world a running `vite dev` hosts: `WORLD_URL` (the base URL printed at startup), else the
 * `world.json` the dev server wrote into this worktree's state directory (`PERSIST_DIR`).
 */
export function findWorld(environment: NodeJS.ProcessEnv = process.env): WorldDescriptor {
  const url = environment["WORLD_URL"];
  if (url) {
    const base = url.replace(/\/+$/, "");
    return {
      url: base,
      control: `${base}/control`,
      github: `${base}/github`,
      githubWeb: `${base}/github-web`,
      resend: `${base}/resend`,
      pid: 0,
    };
  }
  const file = worldFile(persistDirectory(environment));
  if (!existsSync(file)) {
    throw new Error(
      `No local world is running here (${file} does not exist). Start "npm run dev" first, with the same PERSIST_DIR, or set WORLD_URL.`,
    );
  }
  return JSON.parse(readFileSync(file, "utf8")) as WorldDescriptor;
}

export function connectWorld(environment?: NodeJS.ProcessEnv): {
  descriptor: WorldDescriptor;
  control: AsyncControl;
} {
  const descriptor = findWorld(environment);
  return { descriptor, control: remoteControl(descriptor.control) };
}

/** `["seed"]`, `["approveDeviceCode", "ABCD-1234", "mate-maintenance"]`, `["addFault", "{\"service\":...}"]`. */
export function parseCommand(argv: string[]): { method: string; args: unknown[] } {
  const [method, ...rest] = argv;
  if (!method) throw new Error("Usage: npm run world -- <method> [argument ...]  (try: summary)");
  const args = rest.map((text) => {
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return text;
    }
  });
  return { method, args };
}
