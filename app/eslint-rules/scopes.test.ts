import { resolve } from "node:path";
import { ESLint } from "eslint";
import tseslint from "typescript-eslint";
import { describe, expect, it } from "vitest";
import { scopedRules } from "./scopes.ts";

// The rules are tested one by one in rules.test.ts. This checks where they APPLY: that the configuration
// really runs them on client components, and not on code that may legitimately hold such text.
const root = resolve(import.meta.dirname, "..");
const linter = new ESLint({
  cwd: root,
  overrideConfigFile: true,
  overrideConfig: [
    {
      files: ["**/*.{ts,tsx}"],
      languageOptions: {
        parser: tseslint.parser,
        parserOptions: { ecmaFeatures: { jsx: true } },
      },
    },
    ...scopedRules,
  ],
});

async function ruleIds(filePath: string, code: string): Promise<string[]> {
  const [result] = await linter.lintText(code, {
    filePath: resolve(root, filePath),
  });
  return (result?.messages ?? []).map((message) => message.ruleId ?? "(parse error)");
}

describe("where the rules apply", () => {
  it("lints client components for text, colours and layer crossings", async () => {
    const found = await ruleIds(
      "src/client/app/example.tsx",
      [
        'import { app } from "@worker/app.ts";',
        'export const A = () => <p className="bg-gray-100 text-[#1f2328]">Hello</p>;',
      ].join("\n"),
    );
    expect(found).toEqual(
      expect.arrayContaining([
        "reports/no-layer-crossing",
        "reports/no-literal-text",
        "reports/no-hardcoded-colors",
      ]),
    );
  });

  it("lints a copied shadcn component in client/ui like any other", async () => {
    const found = await ruleIds(
      "src/client/ui/dialog.tsx",
      'export const Close = () => <button><span className="sr-only">Close</span></button>;',
    );
    expect(found).toContain("reports/no-literal-text");
  });

  it("lets client tests hold literal text and colours", async () => {
    expect(
      await ruleIds(
        "src/client/app/example.test.tsx",
        'export const x = <p className="bg-white">Hello</p>;',
      ),
    ).toEqual([]);
  });

  it("holds the Worker and shared to their import boundaries but not to the JSX rules", async () => {
    expect(
      await ruleIds(
        "src/worker/example.ts",
        'import { cn } from "@/lib/utils.ts";\nexport { cn };',
      ),
    ).toEqual(["reports/no-layer-crossing"]);
    expect(
      await ruleIds(
        "src/shared/example.ts",
        'import { app } from "@worker/app.ts";\nexport { app };',
      ),
    ).toEqual(["reports/no-layer-crossing"]);
    expect(await ruleIds("src/shared/example.ts", 'export const colour = "#fff";')).toEqual([]);
  });

  it("does not touch tooling, which writes text and colours freely", async () => {
    expect(
      await ruleIds(
        "scripts/example.ts",
        'export const html = "<p style=\\"color:#555\\">Hello</p>";',
      ),
    ).toEqual([]);
  });
});
