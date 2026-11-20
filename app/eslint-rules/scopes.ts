import type { Linter } from "eslint";
import { plugin as reports } from "./index.ts";

/**
 * Where each of this repo's rules applies. Kept apart from eslint.config.js so a test can lint a snippet with
 * exactly these scopes (scopes.test.ts), without the type-aware presets and the project service.
 */
export const scopedRules: Linter.Config[] = [
  // The client: components take their text from the catalog and their colours from the theme tokens.
  {
    files: ["src/client/**/*.{ts,tsx}"],
    plugins: { reports },
    rules: {
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
];
