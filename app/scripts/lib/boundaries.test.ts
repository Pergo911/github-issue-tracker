import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import ts from "typescript";
import { beforeAll, describe, expect, it } from "vitest";
import { APP_ROOT } from "./state.ts";

/**
 * SPEC 2.6: client, worker and shared are separate tsconfig projects, so a cross-import between client and
 * worker, or `shared/` touching an environment global, fails to COMPILE. These tests add a probe file to a
 * project and ask the compiler, so the guarantee holds as long as the tsconfig files do.
 */
function run(script: string, ...args: string[]) {
  execFileSync(process.execPath, [join(APP_ROOT, "node_modules", script), ...args], {
    cwd: APP_ROOT,
    stdio: "pipe",
  });
}

beforeAll(() => {
  if (!existsSync(join(APP_ROOT, "worker-configuration.d.ts"))) {
    run("wrangler/bin/wrangler.js", "types", "--strict-vars", "false");
  }
  // The client and worker projects read the shared project's declaration output.
  run("typescript/bin/tsc", "-b", "tsconfig.shared.json");
}, 120_000);

/** Compiles a project with one extra file in it, and returns the error messages that file produced. */
function errorsWithProbe(tsconfig: string, probe: string, code: string): string[] {
  const configPath = join(APP_ROOT, tsconfig);
  const parsed = ts.getParsedCommandLineOfConfigFile(
    configPath,
    {},
    {
      ...ts.sys,
      onUnRecoverableConfigFileDiagnostic: (diagnostic) => {
        throw new Error(ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"));
      },
    },
  );
  if (!parsed) throw new Error(`cannot read ${tsconfig}`);
  const probePath = resolve(APP_ROOT, probe);
  const host = ts.createCompilerHost(parsed.options);
  const { fileExists, readFile, getSourceFile } = host;
  host.fileExists = (file) => resolve(file) === probePath || fileExists.call(host, file);
  host.readFile = (file) => (resolve(file) === probePath ? code : readFile.call(host, file));
  host.getSourceFile = (file, languageVersion, ...rest) =>
    resolve(file) === probePath
      ? ts.createSourceFile(file, code, languageVersion)
      : getSourceFile.call(host, file, languageVersion, ...rest);
  const program = ts.createProgram({
    rootNames: [...parsed.fileNames, probePath],
    options: parsed.options,
    ...(parsed.projectReferences ? { projectReferences: parsed.projectReferences } : {}),
    host,
  });
  return ts
    .getPreEmitDiagnostics(program)
    .filter((diagnostic) => diagnostic.file && resolve(diagnostic.file.fileName) === probePath)
    .map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"));
}

describe("the three tsconfig projects", () => {
  it("let the client import shared, and the worker import shared", () => {
    expect(
      errorsWithProbe(
        "tsconfig.client.json",
        "src/client/__probe__.ts",
        'import { configSchema } from "@shared/config/schema.ts";\nexport const probe: unknown = configSchema;',
      ),
    ).toEqual([]);
    expect(
      errorsWithProbe(
        "tsconfig.worker.json",
        "src/worker/__probe__.ts",
        'import { configSchema } from "@shared/config/schema.ts";\nexport const probe: unknown = configSchema;',
      ),
    ).toEqual([]);
  }, 120_000);

  it("fail to compile a client file that imports the worker", () => {
    const errors = errorsWithProbe(
      "tsconfig.client.json",
      "src/client/__probe__.ts",
      'import { app } from "../worker/app.ts";\nexport const probe: unknown = app;',
    );
    expect(errors.join("\n")).toMatch(/not listed within the file list of project/);
  }, 120_000);

  it("fail to compile a worker file that imports the client", () => {
    const errors = errorsWithProbe(
      "tsconfig.worker.json",
      "src/worker/__probe__.ts",
      'import { cn } from "../client/lib/utils.ts";\nexport const probe: unknown = cn;',
    );
    expect(errors.join("\n")).toMatch(/not listed within the file list of project/);
  }, 120_000);

  it("fail to compile shared code that imports the client or the worker", () => {
    for (const target of ["../client/lib/utils.ts", "../worker/app.ts"]) {
      const errors = errorsWithProbe(
        "tsconfig.shared.json",
        "src/shared/__probe__.ts",
        `import * as other from "${target}";\nexport const probe: unknown = other;`,
      );
      expect(errors.join("\n"), target).toMatch(/not listed within the file list of project/);
    }
  }, 120_000);

  it("fail to compile shared code that touches an environment global", () => {
    for (const global of ["document", "window", "fetch", "process", "console", "setTimeout"]) {
      const errors = errorsWithProbe(
        "tsconfig.shared.json",
        "src/shared/__probe__.ts",
        `export const probe: unknown = ${global};`,
      );
      expect(errors.join("\n"), global).toMatch(/Cannot find name/);
    }
  }, 120_000);

  it("keep runtime-neutral language features available to shared code", () => {
    expect(
      errorsWithProbe(
        "tsconfig.shared.json",
        "src/shared/__probe__.ts",
        'export const probe = new Intl.DateTimeFormat("hu", { timeZone: "UTC" }).format(new Date(0));',
      ),
    ).toEqual([]);
  }, 120_000);
});
