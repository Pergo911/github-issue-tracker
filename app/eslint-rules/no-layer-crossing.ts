import { dirname, posix, relative, resolve, sep } from "node:path";
import type { TSESTree } from "@typescript-eslint/utils";
import { createRule } from "./create-rule.ts";

/**
 * The import boundaries of SPEC 2.6, checked on the import path itself (TypeScript's project references
 * enforce the same for the compiler: client, worker and shared are separate tsconfig projects):
 *   client  must not import worker      worker  must not import client
 *   shared  must not import client or worker (it is runtime-neutral)
 *   reporter/ must not import staff/    staff/ is reached only through a lazy `import()`, so it stays its own chunk
 */
type Layer = "client" | "reporter" | "staff" | "worker" | "shared";

const APP_ROOT = resolve(import.meta.dirname, "..");

function layerOfPath(path: string): Layer | null {
  if (path.startsWith("src/client/reporter/")) return "reporter";
  if (path.startsWith("src/client/staff/")) return "staff";
  if (path.startsWith("src/client/")) return "client";
  if (path.startsWith("src/worker/")) return "worker";
  if (path.startsWith("src/shared/")) return "shared";
  return null;
}

const ALIASES: [prefix: string, root: string][] = [
  ["@shared/", "src/shared/"],
  ["@worker/", "src/worker/"],
  ["@/", "src/client/"],
];

function appRelative(absolute: string): string {
  return relative(APP_ROOT, absolute).split(sep).join(posix.sep);
}

/** The layer an import specifier points into, or null for a package or a path outside src/. */
function layerOfImport(specifier: string, importer: string): Layer | null {
  for (const [prefix, root] of ALIASES) {
    if (specifier.startsWith(prefix))
      return layerOfPath(`${root}${specifier.slice(prefix.length)}`);
  }
  if (specifier.startsWith("."))
    return layerOfPath(appRelative(resolve(dirname(importer), specifier)));
  return null;
}

const FORBIDDEN: Record<"client" | "reporter" | "staff" | "worker" | "shared", Layer[]> = {
  client: ["worker"],
  reporter: ["worker", "staff"],
  staff: ["worker"],
  worker: ["client", "reporter", "staff"],
  shared: ["client", "reporter", "staff", "worker"],
};

export const noLayerCrossing = createRule({
  name: "no-layer-crossing",
  meta: {
    type: "problem",
    docs: { description: "Keep client, worker and shared apart, and reporter/ away from staff/." },
    messages: {
      forbidden:
        "{{from}} code must not import {{to}} code ({{specifier}}). Put what both need in src/shared/.",
      staffChunk:
        "Static import of staff/ code ({{specifier}}). Reach staff/ only through a lazy route or import(), so it stays its own chunk.",
    },
    schema: [],
  },
  defaultOptions: [],
  create(context) {
    const importer = resolve(context.filename);
    const from = layerOfPath(appRelative(importer));
    if (from === null) return {};
    const fromLayer: Layer = from;

    function check(node: TSESTree.Node, specifier: string, isDynamic: boolean) {
      const to = layerOfImport(specifier, importer);
      if (to === null || to === fromLayer) return;
      if (FORBIDDEN[fromLayer].includes(to)) {
        context.report({ node, messageId: "forbidden", data: { from: fromLayer, to, specifier } });
        return;
      }
      if (to === "staff" && !isDynamic && fromLayer !== "staff") {
        context.report({ node, messageId: "staffChunk", data: { specifier } });
      }
    }

    return {
      ImportDeclaration: (node) => check(node, node.source.value, false),
      ExportAllDeclaration: (node) => check(node, node.source.value, false),
      ExportNamedDeclaration: (node) => {
        if (node.source) check(node, node.source.value, false);
      },
      ImportExpression: (node) => {
        if (node.source.type === "Literal" && typeof node.source.value === "string") {
          check(node, node.source.value, true);
        }
      },
    };
  },
});
