import js from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";
import { plugin as reports } from "./eslint-rules/index.ts";

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

  // The client: React, the DOM, and this repo's rules for components.
  {
    files: ["src/client/**/*.{ts,tsx}"],
    plugins: { reports, "react-hooks": reactHooks },
    languageOptions: { globals: globals.browser },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "reports/no-layer-crossing": "error",
      "reports/no-literal-text": "error",
      "reports/no-hardcoded-colors": "error",
    },
  },
  // Tests may write literals and colours, to test them.
  {
    files: ["src/client/**/*.test.{ts,tsx}"],
    rules: { "reports/no-literal-text": "off", "reports/no-hardcoded-colors": "off" },
  },
  // The Worker and the shared module keep to their own side.
  {
    files: ["src/worker/**/*.ts", "src/shared/**/*.ts"],
    plugins: { reports },
    rules: { "reports/no-layer-crossing": "error" },
  },
  // Tooling, end-to-end tests and configuration run in Node, or drive a browser.
  {
    files: ["scripts/**/*.ts", "e2e/**/*.ts", "eslint-rules/**/*.ts", "*.config.{ts,js}"],
    languageOptions: { globals: { ...globals.node } },
  },
  // The typescript-eslint AST node types are string enums, compared here by their string values.
  {
    files: ["eslint-rules/**/*.ts"],
    rules: { "@typescript-eslint/no-unsafe-enum-comparison": "off" },
  },
  // Tests assert on loosely typed JSON on purpose.
  {
    files: ["**/*.test.ts", "e2e/**/*.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/unbound-method": "off",
    },
  },
]);
