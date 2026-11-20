/**
 * The static assets' `_headers` file (Cloudflare reads it from the client build): the Status link carries a
 * capability token in its path, so SPEC 4.3 requires `Referrer-Policy: no-referrer` for `/status/*`.
 */
export function checkHeaders(text: string): string[] {
  const problems: string[] = [];
  const lines = text.split(/\r?\n/);
  const rule = lines.findIndex((line) => line.trim() === "/status/*");
  if (rule === -1) return ["_headers has no rule for /status/*"];
  const block: string[] = [];
  for (const line of lines.slice(rule + 1)) {
    if (!/^\s+\S/.test(line)) break;
    block.push(line.trim().toLowerCase());
  }
  if (!block.includes("referrer-policy: no-referrer")) {
    problems.push("the /status/* rule in _headers does not set Referrer-Policy: no-referrer");
  }
  return problems;
}
