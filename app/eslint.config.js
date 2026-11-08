import js from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";
import { scopedRules } from "./eslint-rules/scopes.ts";

export default defineConfig([
  globalIgnores([
    "node_modules/",
    "dist/",
    ".tsbuild/",
    ".wrangler/",
    ".screenshots/",
    ".tmp/",
    "playwright-report/",
    "test-results/",
    "worker-configuration.d.ts",
    "e2e/reference/",
  ]),

  js.configs.recommended,
  tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: { allowDefaultProject: ["eslint.config.js"] },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/consistent-type-imports": ["error", { fixStyle: "inline-type-imports" }],
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-explicit-any": "error",
    },
  },
  // Plain JavaScript (this file) is not type-checked.
  { files: ["**/*.js"], extends: [tseslint.configs.disableTypeChecked] },

  // The client: React and the DOM.
  {
    files: ["src/client/**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks },
    languageOptions: { globals: globals.browser },
    rules: reactHooks.configs.recommended.rules,
  },
  // This repo's own rules, and where each applies (eslint-rules/scopes.ts, tested in scopes.test.ts).
  ...scopedRules,
  // Tooling, end-to-end tests and configuration run in Node, or drive a browser.
  {
    files: [
      "scripts/**/*.ts",
      "e2e/**/*.ts",
      "eslint-rules/**/*.ts",
      "*.config.{ts,js}",
      "fakes/node/**/*.ts",
    ],
    languageOptions: { globals: { ...globals.node } },
  },
  // The typescript-eslint AST node types are string enums, compared here by their string values.
  {
    files: ["eslint-rules/**/*.ts"],
    rules: { "@typescript-eslint/no-unsafe-enum-comparison": "off" },
  },
  // Tests assert on loosely typed JSON on purpose.
  {
    files: ["**/*.test.ts", "e2e/**/*.ts", "fakes/testing/**/*.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-return": "off",
      "@typescript-eslint/unbound-method": "off",
    },
  },
]);
