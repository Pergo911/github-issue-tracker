import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { APP_ROOT } from "./state.ts";

const require = createRequire(import.meta.url);

describe(".github/workflows/verify.yml", () => {
  it("pins the Playwright container image to the installed @playwright/test version", () => {
    const { version } = require("@playwright/test/package.json") as { version: string };
    const workflow = readFileSync(
      join(APP_ROOT, "..", ".github", "workflows", "verify.yml"),
      "utf8",
    );
    expect(workflow).toContain(`mcr.microsoft.com/playwright:v${version}-noble`);
  });
});
