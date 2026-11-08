import { noHardcodedColors } from "./no-hardcoded-colors.ts";
import { noLayerCrossing } from "./no-layer-crossing.ts";
import { noLiteralText } from "./no-literal-text.ts";

/** This repo's own rules, registered in eslint.config.js as the `reports` plugin. */
export const plugin = {
  meta: { name: "reports" },
  rules: {
    "no-layer-crossing": noLayerCrossing,
    "no-literal-text": noLiteralText,
    "no-hardcoded-colors": noHardcodedColors,
  },
};
