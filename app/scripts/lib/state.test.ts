import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { configSchema } from "../../src/shared/config/schema.ts";
import { readLocalConfig, resetLocalState, seedLocalConfig, assertDisposable } from "./state.ts";

const directories: string[] = [];
function temporaryState() {
  const directory = mkdtempSync(join(tmpdir(), "reports-state-test-"));
  directories.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("local state", () => {
  it("starts empty: a fresh state directory has no config key", async () => {
    expect(await readLocalConfig(temporaryState())).toBeNull();
  });

  it("seeds the Appendix A configuration into local KV", async () => {
    const state = temporaryState();
    await seedLocalConfig(state);
    const stored = configSchema.parse(await readLocalConfig(state));
    expect(stored.language).toBe("hu");
    expect(stored.timezone).toBe("Europe/Budapest");
    expect(stored.taxonomy.status.map((value) => value.id)).toEqual(["new", "in-progress", "on-hold"]);
  }, 60_000);

  it("seeds again without error and keeps one configuration", async () => {
    const state = temporaryState();
    await seedLocalConfig(state);
    await seedLocalConfig(state);
    expect(configSchema.safeParse(await readLocalConfig(state)).success).toBe(true);
  }, 60_000);

  it("reset clears all local state", async () => {
    const state = temporaryState();
    await seedLocalConfig(state);
    resetLocalState(state);
    expect(existsSync(state)).toBe(false);
    expect(await readLocalConfig(state)).toBeNull();
  }, 60_000);

  it("refuses to delete a directory that is neither inside this worktree nor a temporary one", () => {
    expect(() => assertDisposable(join(tmpdir(), "..", "..", "Windows"))).toThrow(/refus/i);
    expect(() => assertDisposable("/")).toThrow(/refus/i);
    expect(() => assertDisposable(join(import.meta.dirname, "..", "..", ".wrangler", "state"))).not.toThrow();
    expect(() => assertDisposable(join(tmpdir(), "reports-state-x"))).not.toThrow();
  });
});
