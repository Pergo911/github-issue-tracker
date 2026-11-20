import type { ESLint } from "eslint";
import { noHardcodedColors } from "./no-hardcoded-colors.ts";
import { noLayerCrossing } from "./no-layer-crossing.ts";
import { noLiteralText } from "./no-literal-text.ts";

/** This repo's own rules, registered in eslint.config.js as the `reports` plugin. */
// typescript-eslint's rule types are narrower than ESLint core's, so the plugin is typed as ESLint expects it.
export const plugin = {
  meta: { name: "reports" },
  rules: {
    "no-layer-crossing": noLayerCrossing,
    "no-literal-text": noLiteralText,
    "no-hardcoded-colors": noHardcodedColors,
  },
} as unknown as ESLint.Plugin;
