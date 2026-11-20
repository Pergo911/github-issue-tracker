import { RuleTester } from "@typescript-eslint/rule-tester";
import { afterAll, describe, it } from "vitest";
import { noHardcodedColors } from "./no-hardcoded-colors.ts";
import { noLayerCrossing } from "./no-layer-crossing.ts";
import { noLiteralText } from "./no-literal-text.ts";

RuleTester.afterAll = afterAll;
RuleTester.describe = describe;
RuleTester.it = it;

const tester = new RuleTester({
  languageOptions: { parserOptions: { ecmaFeatures: { jsx: true } } },
});

const client = "src/client/app/home.tsx";

describe("rules", () => {
  tester.run("no-layer-crossing", noLayerCrossing, {
    valid: [
      { code: 'import { x } from "@shared/config/schema.ts";', filename: client },
      { code: 'import { x } from "../../shared/config/schema.ts";', filename: client },
      { code: 'import { x } from "@/ui/button.tsx";', filename: client },
      { code: 'import { x } from "@shared/api/endpoints.ts";', filename: "src/worker/app.ts" },
      { code: 'import { x } from "react";', filename: "src/shared/config/schema.ts" },
      { code: 'import { x } from "./schema.ts";', filename: "src/shared/config/public.ts" },
      {
        code: 'import { x } from "@/reporter/form.tsx";',
        filename: "src/client/reporter/page.tsx",
      },
      { code: 'import { x } from "@/staff/board.tsx";', filename: "src/client/staff/page.tsx" },
      { code: 'const page = () => import("@/staff/board.tsx");', filename: client },
      { code: 'import { x } from "../../src/worker/index.ts";', filename: "scripts/seed.ts" },
    ],
    invalid: [
      {
        code: 'import { app } from "@worker/app.ts";',
        filename: client,
        errors: [{ messageId: "forbidden" }],
      },
      {
        code: 'import { app } from "../../worker/app.ts";',
        filename: client,
        errors: [{ messageId: "forbidden" }],
      },
      {
        code: 'import type { Env } from "@worker/env.ts";',
        filename: client,
        errors: [{ messageId: "forbidden" }],
      },
      {
        code: 'export { thing } from "@worker/app.ts";',
        filename: client,
        errors: [{ messageId: "forbidden" }],
      },
      {
        code: 'const lazy = () => import("@worker/app.ts");',
        filename: client,
        errors: [{ messageId: "forbidden" }],
      },
      {
        code: 'import { page } from "@/ui/button.tsx";',
        filename: "src/worker/app.ts",
        errors: [{ messageId: "forbidden" }],
      },
      {
        code: 'import { page } from "../client/main.tsx";',
        filename: "src/worker/app.ts",
        errors: [{ messageId: "forbidden" }],
      },
      {
        code: 'import { x } from "@worker/app.ts";',
        filename: "src/shared/config/schema.ts",
        errors: [{ messageId: "forbidden" }],
      },
      {
        code: 'import { x } from "../../client/lib/utils.ts";',
        filename: "src/shared/config/schema.ts",
        errors: [{ messageId: "forbidden" }],
      },
      {
        code: 'import { Board } from "@/staff/board.tsx";',
        filename: "src/client/reporter/page.tsx",
        errors: [{ messageId: "forbidden" }],
      },
      {
        code: 'import { Board } from "../staff/board.tsx";',
        filename: "src/client/reporter/page.tsx",
        errors: [{ messageId: "forbidden" }],
      },
      {
        code: 'import { Board } from "@/staff/board.tsx";',
        filename: client,
        errors: [{ messageId: "staffChunk" }],
      },
    ],
  });

  tester.run("no-literal-text", noLiteralText, {
    valid: [
      { code: "const a = <p>{t('home.heading')}</p>;", filename: client },
      { code: "const a = <p>{name}</p>;", filename: client },
      { code: "const a = <span> · </span>;", filename: client },
      { code: "const a = <p>12 / 40</p>;", filename: client },
      { code: "const a = <button aria-label={t('x')} />;", filename: client },
      { code: "const a = <input placeholder={t('x')} />;", filename: client },
      { code: 'const a = <a href="#main" className="sr-only" />;', filename: client },
      { code: 'const a = <img alt="" src="x" />;', filename: client },
      { code: "const a = <p>{`${count}`}</p>;", filename: client },
    ],
    invalid: [
      { code: "const a = <p>Hello</p>;", filename: client, errors: [{ messageId: "text" }] },
      { code: "const a = <p>Hello {name}</p>;", filename: client, errors: [{ messageId: "text" }] },
      { code: "const a = <p>{'Hello'}</p>;", filename: client, errors: [{ messageId: "text" }] },
      { code: "const a = <p>{`Hello`}</p>;", filename: client, errors: [{ messageId: "text" }] },
      {
        code: "const a = <p>{`Hello ${name}`}</p>;",
        filename: client,
        errors: [{ messageId: "text" }],
      },
      {
        code: 'const a = <button aria-label="Close" />;',
        filename: client,
        errors: [{ messageId: "prop" }],
      },
      {
        code: "const a = <button aria-label={'Close'} />;",
        filename: client,
        errors: [{ messageId: "prop" }],
      },
      {
        code: 'const a = <input placeholder="Search" />;',
        filename: client,
        errors: [{ messageId: "prop" }],
      },
      {
        code: 'const a = <img alt="Logo" src="x" />;',
        filename: client,
        errors: [{ messageId: "prop" }],
      },
      {
        code: 'const a = <div title="Info" />;',
        filename: client,
        errors: [{ messageId: "prop" }],
      },
      {
        code: 'const a = <Dialog aria-description="Details" />;',
        filename: client,
        errors: [{ messageId: "prop" }],
      },
      {
        code: "const a = <p>Ő és ű</p>;",
        filename: client,
        errors: [{ messageId: "text" }],
      },
    ],
  });

  tester.run("no-hardcoded-colors", noHardcodedColors, {
    valid: [
      {
        code: 'const c = "bg-primary text-primary-foreground hover:bg-primary-hover";',
        filename: client,
      },
      {
        code: 'const c = "border-secondary-border bg-neutral-muted text-state-open";',
        filename: client,
      },
      {
        code: 'const c = "bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_5%)]";',
        filename: client,
      },
      { code: 'const a = <a href="#main" />;', filename: client },
      { code: "const s = { color: 'var(--link)', background: 'transparent' };", filename: client },
      { code: 'const c = "text-sm font-medium";', filename: client },
      { code: "const c = `size-${n} bg-card`;", filename: client },
    ],
    invalid: [
      { code: 'const c = "#fff";', filename: client, errors: [{ messageId: "color" }] },
      { code: 'const c = "color: #1f2328";', filename: client, errors: [{ messageId: "color" }] },
      { code: 'const c = "bg-[#d1d9e0]";', filename: client, errors: [{ messageId: "color" }] },
      { code: 'const c = "#1f232880";', filename: client, errors: [{ messageId: "color" }] },
      { code: 'const c = "rgb(0 0 0)";', filename: client, errors: [{ messageId: "color" }] },
      {
        code: 'const c = "rgba(0, 0, 0, .5)";',
        filename: client,
        errors: [{ messageId: "color" }],
      },
      {
        code: 'const c = "hsl(210deg 10% 50%)";',
        filename: client,
        errors: [{ messageId: "color" }],
      },
      { code: 'const c = "oklch(0.5 0 0)";', filename: client, errors: [{ messageId: "color" }] },
      {
        code: 'const c = "bg-white text-black";',
        filename: client,
        errors: [{ messageId: "palette" }, { messageId: "palette" }],
      },
      { code: 'const c = "bg-gray-100";', filename: client, errors: [{ messageId: "palette" }] },
      {
        code: 'const c = "hover:text-red-500 dark:border-slate-700/50";',
        filename: client,
        errors: [{ messageId: "palette" }, { messageId: "palette" }],
      },
      {
        code: "const c = `p-2 ring-blue-500`;",
        filename: client,
        errors: [{ messageId: "palette" }],
      },
      { code: "const s = { color: 'red' };", filename: client, errors: [{ messageId: "style" }] },
      {
        code: "const s = { backgroundColor: '#fff' };",
        filename: client,
        errors: [{ messageId: "color" }],
      },
    ],
  });
});
