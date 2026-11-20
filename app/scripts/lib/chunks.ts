/** The slice of Vite's build manifest (dist/client/.vite/manifest.json) these checks read. */
export interface ManifestEntry {
  file: string;
  src?: string;
  isEntry?: boolean;
  isDynamicEntry?: boolean;
  imports?: string[];
  dynamicImports?: string[];
}
export type Manifest = Record<string, ManifestEntry>;

const STAFF = "src/client/staff/";
const REPORTER = "src/client/reporter/";

/** Every chunk reachable from `key` through static imports only: what a browser loads before running it. */
function staticClosure(manifest: Manifest, key: string): Set<string> {
  const seen = new Set<string>();
  const visit = (current: string) => {
    if (seen.has(current)) return;
    seen.add(current);
    for (const next of manifest[current]?.imports ?? []) visit(next);
  };
  visit(key);
  return seen;
}

/**
 * SPEC 2.6: `staff/` is a separate chunk that reporters never download. Returns what is wrong with a build.
 * A staff module that was merged into another chunk leaves no chunk of its own, so that fails too.
 */
export function checkChunks(manifest: Manifest): string[] {
  const entryKey = Object.keys(manifest).find((key) => manifest[key]?.isEntry);
  if (entryKey === undefined) return ["The build has no entry chunk."];

  const staffKeys = Object.keys(manifest).filter((key) => manifest[key]?.src?.startsWith(STAFF));
  if (staffKeys.length === 0) {
    return [
      "No chunk holds the staff routes: staff/ must be its own chunk, reached through a lazy route.",
    ];
  }

  const problems: string[] = [];
  const upFront = staticClosure(manifest, entryKey);
  for (const key of staffKeys) {
    if (upFront.has(key)) problems.push(`The entry chunk loads the staff chunk up front (${key}).`);
  }
  for (const key of Object.keys(manifest)) {
    if (!manifest[key]?.src?.startsWith(REPORTER)) continue;
    const closure = staticClosure(manifest, key);
    for (const staffKey of staffKeys) {
      if (closure.has(staffKey))
        problems.push(`The reporter chunk ${key} loads the staff chunk (${staffKey}).`);
    }
  }
  return problems;
}
