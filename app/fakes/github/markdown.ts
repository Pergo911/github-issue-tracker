/**
 * The fake's `body_html`: a deliberately small renderer of the one shape the design relies on (SPEC 4.3), a
 * fenced code block, plus plain paragraphs. It is NOT GitHub's Markdown pipeline. Text outside a fence is
 * escaped and kept as text: the fake never auto-links, mentions or references, which GitHub does, so a test of
 * what GitHub does with unfenced text (the title alphabet, ticket #32) can only run live.
 */

export function escapeHtml(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function paragraph(lines: string[]): string {
  const html = escapeHtml(lines.join("\n")).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  return `<p dir="auto">${html}</p>`;
}

export function renderMarkdown(source: string): string {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const blocks: string[] = [];
  let text: string[] = [];
  const flush = () => {
    if (text.some((line) => line.trim() !== "")) blocks.push(paragraph(text));
    text = [];
  };
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] as string;
    const opening = /^ {0,3}(`{3,})[^`]*$/.exec(line);
    if (!opening) {
      if (line.trim() === "") flush();
      else text.push(line);
      continue;
    }
    flush();
    const fence = (opening[1] as string).length;
    const code: string[] = [];
    // A closing fence is a run of at least as many backticks and nothing else; an unclosed one runs to the end.
    for (index += 1; index < lines.length; index += 1) {
      const next = lines[index] as string;
      const closing = /^ {0,3}(`{3,})\s*$/.exec(next);
      if (closing && (closing[1] as string).length >= fence) break;
      code.push(next);
    }
    const escaped = escapeHtml(code.join("\n"));
    blocks.push(
      `<div class="snippet-clipboard-content notranslate position-relative overflow-auto"><pre class="notranslate"><code class="notranslate">${escaped}\n</code></pre></div>`,
    );
  }
  flush();
  return blocks.join("\n");
}

/** Whether the caller asked for the rendered body: `application/vnd.github.html+json` or `.full+json`. */
export function wantsHtml(accept: string | null): boolean {
  return /application\/vnd\.github(?:\.v3)?\.(?:html|full)\+json/i.test(accept ?? "");
}
