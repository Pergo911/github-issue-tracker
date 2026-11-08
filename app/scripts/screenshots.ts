// `npm run screenshots [-- <playwright args>]`: capture every declared screen and state (e2e/screens.ts),
// light and dark, at 1280 and 375 px wide, in Hungarian, with YOUR local browser (so you see real font
// rendering). Writes into .screenshots/ (git-ignored) and an index page to browse it.
// Open every image of every screen you added or changed and check it against docs/ui-github-look.md
// and the catalog: that is part of the definition of done (AGENTS.md).
// Example:  npm run screenshots -- -g "home"      (only the screens whose name matches)
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { COLOR_SCHEMES, screens, VIEWPORTS } from "../e2e/screens.ts";
import { prepareRun, runPlaywright } from "./lib/run.ts";
import { APP_ROOT } from "./lib/state.ts";

const output = join(APP_ROOT, ".screenshots");
const escapeHtml = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function indexPage(): string {
  const sections = screens
    .map((screen) => {
      const figures = VIEWPORTS.flatMap((viewport) =>
        COLOR_SCHEMES.map(
          (scheme) =>
            `<figure class="${viewport.name === "375" ? "narrow" : "wide"}"><a href="${screen.id}/${scheme}-${viewport.name}.png"><img loading="lazy" src="${screen.id}/${scheme}-${viewport.name}.png" alt="${escapeHtml(`${screen.id}, ${scheme}, ${viewport.name} px`)}"></a><figcaption>${scheme}, ${viewport.name} px</figcaption></figure>`,
        ),
      ).join("\n");
      return `<section id="${screen.id}"><h2>${screen.id}</h2><p>${escapeHtml(screen.description)}</p><div class="grid">${figures}</div></section>`;
    })
    .join("\n");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Screenshots</title>
<style>
body{font:14px/1.5 system-ui,sans-serif;margin:24px;max-width:1500px}
h2{margin:32px 0 0}p{margin:4px 0 12px;color:#555}
.grid{display:flex;flex-wrap:wrap;gap:16px;align-items:flex-start}
figure{margin:0}figcaption{font-size:12px;color:#555}
.wide img{width:620px}.narrow img{width:300px}img{border:1px solid #888;display:block}
</style></head><body><h1>Screenshots</h1>
<p>Generated ${new Date().toISOString()} by <code>npm run screenshots</code>. Light and dark, 1280 and 375 px wide, in Hungarian, in your local browser.</p>
<nav>${screens.map((screen) => `<a href="#${screen.id}">${screen.id}</a>`).join(" · ")}</nav>
${sections}</body></html>`;
}

rmSync(output, { recursive: true, force: true });
mkdirSync(output, { recursive: true });
const run = await prepareRun();
let code = 1;
try {
  code = await runPlaywright(["--project=screenshots", ...process.argv.slice(2)], {
    ...run.env,
    SCREENSHOT_DIR: output,
  });
} finally {
  run.cleanup();
}
writeFileSync(join(output, "index.html"), indexPage());
console.log(`\nScreenshots: ${join(output, "index.html")}\n${pathToFileURL(join(output, "index.html")).href}`);
process.exit(code);
