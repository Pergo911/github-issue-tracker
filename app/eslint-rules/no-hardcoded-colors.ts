import type { TSESTree } from "@typescript-eslint/utils";
import { createRule } from "./create-rule.ts";

/**
 * Components use theme tokens only (SPEC 2.7): colours come from Primer's variables through the aliases in
 * src/client/ui/theme.css, so light and dark both hold. This rejects, in client code:
 *   - hex, rgb(), hsl() (and hwb, lab, lch, oklab, oklch) colours written in a string,
 *   - Tailwind's palette classes (bg-gray-100, text-red-500, border-white, ...). The token classes
 *     (bg-primary, text-muted-foreground, bg-neutral-muted, ...) are not palette classes and pass,
 *   - a literal colour in a `style` object.
 */
const HEX = /(?<![\w&])#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4})(?![\w-])/i;
const FUNCTION = /\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\(/i;

const PALETTE_NAMES =
  "slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|mauve|olive|mist|taupe";
const COLOR_UTILITIES =
  "bg|text|border|border-[xytblrse]|ring|ring-offset|outline|fill|stroke|from|via|to|decoration|divide|accent|caret|shadow|placeholder|inset-shadow|inset-ring|drop-shadow|text-shadow";
const PALETTE = new RegExp(
  `(?<![\\w-])(?:${COLOR_UTILITIES})-(?:(?:${PALETTE_NAMES})(?:-(?:50|[1-9]00|950))?|black|white)(?![\\w-])`,
  "g",
);

const COLOR_STYLE_PROPERTIES = new Set([
  "color",
  "background",
  "backgroundColor",
  "borderColor",
  "borderTopColor",
  "borderRightColor",
  "borderBottomColor",
  "borderLeftColor",
  "outlineColor",
  "fill",
  "stroke",
  "caretColor",
  "accentColor",
  "textDecorationColor",
]);
const NEUTRAL_STYLE_VALUE = /^(?:var\(.*\)|inherit|initial|unset|currentcolor|transparent|none)$/i;

export const noHardcodedColors = createRule({
  name: "no-hardcoded-colors",
  meta: {
    type: "problem",
    docs: { description: "Use theme tokens, never a hard-coded colour." },
    messages: {
      color:
        "Hard-coded colour {{value}}. Use a theme token class (bg-card, text-muted-foreground, border-border, ...).",
      palette:
        "Tailwind palette class {{value}}. Use a theme token class (bg-card, text-muted-foreground, border-border, ...).",
      style:
        "Literal colour in a style object. Use a theme variable: var(--link), var(--border), ...",
    },
    schema: [],
  },
  defaultOptions: [],
  create(context) {
    function checkText(node: TSESTree.Node, text: string) {
      const hex = HEX.exec(text);
      const fn = FUNCTION.exec(text);
      if (hex) context.report({ node, messageId: "color", data: { value: hex[0] } });
      else if (fn) context.report({ node, messageId: "color", data: { value: fn[0] } });
      for (const match of text.matchAll(PALETTE)) {
        context.report({ node, messageId: "palette", data: { value: match[0] } });
      }
    }

    return {
      Literal(node) {
        if (typeof node.value === "string") checkText(node, node.value);
      },
      TemplateElement(node) {
        checkText(node, node.value.cooked ?? "");
      },
      Property(node) {
        const key = node.key.type === "Identifier" ? node.key.name : null;
        if (key === null || !COLOR_STYLE_PROPERTIES.has(key)) return;
        if (node.value.type !== "Literal" || typeof node.value.value !== "string") return;
        const value = node.value.value.trim();
        if (HEX.test(value) || FUNCTION.test(value)) return; // already reported as a colour
        if (!NEUTRAL_STYLE_VALUE.test(value)) {
          context.report({ node: node.value, messageId: "style" });
        }
      },
    };
  },
});
