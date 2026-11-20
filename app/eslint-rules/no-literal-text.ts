import type { TSESTree } from "@typescript-eslint/utils";
import { createRule } from "./create-rule.ts";

/**
 * No component carries its own English (SPEC 2.5): every visible and every screen-reader string comes from
 * the catalog (`t("key")`). This rejects letters written directly as JSX text or as the value of a prop
 * that names or describes an element. Punctuation and numbers on their own are fine. It cannot see every
 * way a string reaches the screen; the end-to-end pseudo-language sweep is the net underneath it.
 */
const ACCESSIBLE_PROPS = new Set([
  "aria-label",
  "aria-description",
  "aria-roledescription",
  "aria-valuetext",
  "aria-placeholder",
  "aria-braillelabel",
  "aria-brailleroledescription",
  "alt",
  "title",
  "placeholder",
  "label",
]);

const HAS_LETTER = /\p{L}/u;

function literalText(node: TSESTree.Node): string | null {
  if (node.type === "Literal" && typeof node.value === "string") return node.value;
  if (node.type === "TemplateLiteral")
    return node.quasis.map((quasi) => quasi.value.cooked ?? "").join("");
  return null;
}

export const noLiteralText = createRule({
  name: "no-literal-text",
  meta: {
    type: "problem",
    docs: { description: "Take every visible and screen-reader string from the catalog." },
    messages: {
      text: 'Text written in JSX bypasses the catalog. Add a key to src/shared/i18n/en.ts (and hu.ts) and render t("...").',
      prop: 'The "{{name}}" prop is read by users or screen readers, so its text must come from the catalog: t("...").',
    },
    schema: [],
  },
  defaultOptions: [],
  create(context) {
    return {
      JSXText(node) {
        if (HAS_LETTER.test(node.value)) context.report({ node, messageId: "text" });
      },
      JSXExpressionContainer(node) {
        if (node.parent.type === "JSXAttribute") return;
        const text = literalText(node.expression);
        if (text !== null && HAS_LETTER.test(text)) context.report({ node, messageId: "text" });
      },
      JSXAttribute(node) {
        if (node.name.type !== "JSXIdentifier" || !ACCESSIBLE_PROPS.has(node.name.name)) return;
        const value = node.value;
        if (value === null) return;
        const text =
          value.type === "JSXExpressionContainer"
            ? literalText(value.expression)
            : literalText(value);
        if (text !== null && HAS_LETTER.test(text)) {
          context.report({ node, messageId: "prop", data: { name: node.name.name } });
        }
      },
    };
  },
});
