// `npm run check:titles`: the live check of the restricted title alphabet (SPEC 4.1, ticket #32). It creates one
// `reports-sandbox` issue per candidate title with the real Bot, reads the raw titles back (REST) and GitHub's
// rendered titles (GraphQL `titleHTML`), looks for links, mentions, references, emoji and markup, and prints a
// table: is the candidate allowed by the validator, did GitHub keep the raw title, did it render anything but
// plain text, did the issue's timeline grow a `mentioned` or `cross-referenced` event. Every issue it creates is
// closed as `not_planned` at the end. Credentials: the same as the live contract suite (AGENTS.md).
import { writeFileSync } from "node:fs";
import {
  MAX_TITLE,
  MIN_TITLE,
  TITLE_ALLOWED_PUNCTUATION,
  TITLE_ALPHABET,
} from "../src/shared/reports/validate.ts";
import { liveCredentials, liveTarget } from "../fakes/node/contract/target.ts";

process.env["CONTRACT_LIVE"] = "1";
const live = liveCredentials();
if ("skip" in live) {
  console.error(`Cannot check: ${live.skip}`);
  process.exit(1);
}
const target = liveTarget(live.credentials);
const bot = await target.botToken();

interface Candidate {
  group: string;
  title: string;
}

const candidates: Candidate[] = [
  // Everything the validator allows, and the shapes the ticket names.
  { group: "hungarian", title: "Árvíztűrő tükörfúrógép ÁÉÍÓÖŐÚÜŰ áéíóöőúüű" },
  { group: "hungarian", title: "Elakadt a lift a 3. emeleten" },
  { group: "hungarian", title: "Gondnok (Kovács János) - 3. emelet, B lépcsőház" },
  { group: "digits", title: "0123456789" },
  { group: "digits", title: "1234" },
  { group: "digits", title: "12" },
  { group: "digits", title: "007" },
  { group: "digits", title: "3.14 és 2,5" },
  { group: "digits", title: "06 30 123 4567" },
  { group: "digits", title: "1-2-3" },
  { group: "digits", title: "2026" },
  { group: "digits", title: "42 42 42" },
  ...TITLE_ALLOWED_PUNCTUATION.map((mark) => ({
    group: "punctuation",
    title: `Hiba ${mark} jelzés`,
  })),
  { group: "punctuation", title: "Hiba?! (nagyon) — tényleg – „idézet” és ‘más’" },
  { group: "punctuation", title: "- első elem" },
  { group: "punctuation", title: "--- vonal" },
  { group: "punctuation", title: "1. pont" },
  { group: "punctuation", title: "(c) (r) (tm)" },
  { group: "domain-like", title: "example.hu" },
  { group: "domain-like", title: "www.example.hu" },
  { group: "domain-like", title: "Hiba a www.example.com oldalon" },
  { group: "domain-like", title: "mail.berautoapp.hu" },
  { group: "domain-like", title: "Lift.2.emelet" },
  { group: "domain-like", title: "v1.2.3" },
  { group: "domain-like", title: "readme.md" },
  { group: "domain-like", title: "192.168.0.1" },
  { group: "domain-like", title: "kiss.anna.example.hu" },
  { group: "domain-like", title: "anna.kiss.example" },
  { group: "hex", title: "da39a3ee5e6b4b0d3255bfef95601890afd80709" },
  {
    group: "hex",
    title: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  },
  { group: "hex", title: "da39a3e" },
  { group: "hex", title: "a1b2c3d4" },
  { group: "hex", title: "deadbeef" },
  { group: "hex", title: "0123456789abcdef0123456789abcdef" },
  { group: "hex", title: "Hiba da39a3e javítás" },
  { group: "hex", title: "ABCDEF1234567" },
  { group: "hex", title: "1234567" },
  { group: "references", title: "GH-1" },
  { group: "references", title: "GH 1" },
  { group: "references", title: "Issue 1" },
  { group: "references", title: "Pergo911" },
  { group: "references", title: "octocat" },
  { group: "references", title: "Tarsashaz-demo reports-sandbox 1" },
  { group: "references", title: "Tarsashaz-demo" },
  { group: "references", title: "Bejelentés 1 vagy 2" },
  { group: "unicode", title: "Café combining" },
  { group: "unicode", title: "Привет мир" },
  { group: "unicode", title: "你好世界" },
  { group: "unicode", title: "Ünïcödé ŉ ǅ ǆ" },
  { group: "unicode", title: "½ ² ③ ٣" },
  { group: "unicode", title: "ﬁ ligature" },
  // Probes: characters the validator rejects, to see what GitHub would have done with them.
  { group: "probe", title: "@octocat" },
  { group: "probe", title: "@Pergo911 kérem" },
  { group: "probe", title: "@Tarsashaz-demo/team" },
  { group: "probe", title: "#1" },
  { group: "probe", title: "Duplicate of #1" },
  { group: "probe", title: "Tarsashaz-demo/reports-sandbox#1" },
  { group: "probe", title: "https://example.com/x" },
  { group: "probe", title: "http://example.hu" },
  { group: "probe", title: "mailto:a@example.hu" },
  { group: "probe", title: "anna@example.hu" },
  { group: "probe", title: "`code`" },
  { group: "probe", title: "**bold** _it_ ~~gone~~" },
  { group: "probe", title: "[link](http://example.com)" },
  { group: "probe", title: "<b>bold</b> <script>x</script>" },
  { group: "probe", title: "&amp; &lt; &#35;" },
  { group: "probe", title: ":smile: :+1: :tada:" },
  { group: "probe", title: "Idő 12:30" },
  { group: "probe", title: "a/b\\c" },
  { group: "probe", title: "🙂 emoji" },
  { group: "probe", title: "zero​width" },
  { group: "probe", title: "bidi ‮abc‬ end" },
  { group: "probe", title: "$x$ math" },
  { group: "probe", title: "50% off; a=b | c * d" },
  // Characters Hungarian reports plausibly contain, one at a time, to decide what else could be allowed.
  { group: "candidate", title: "Hiba „idézet” után" },
  { group: "candidate", title: "Hiba ‚idézet’ után" },
  { group: "candidate", title: "Hiba »idézet« után" },
  { group: "candidate", title: "Hiba «idézet» után" },
  { group: "candidate", title: "Várjuk… sokáig" },
  { group: "candidate", title: "Hiba · jelzés" },
  { group: "candidate", title: "3/B lépcsőház" },
  { group: "candidate", title: "Hiba & javítás" },
  { group: "candidate", title: "Hiba + javítás" },
  { group: "candidate", title: "10% víz" },
  { group: "candidate", title: "Hiba; javítás" },
  { group: "candidate", title: "Idő: 12:30" },
  { group: "candidate", title: "a=b" },
  { group: "candidate", title: "Lift*2" },
  { group: "candidate", title: "a_b_c" },
  { group: "candidate", title: "Lift ~ 3" },
  { group: "candidate", title: "a | b" },
  { group: "candidate", title: "Hiba [B] jelzés" },
  { group: "candidate", title: "Hiba {B} jelzés" },
  { group: "candidate", title: "Hiba $5 jelzés" },
  { group: "candidate", title: "Hiba ^ jelzés" },
  { group: "candidate", title: "Hiba § 5 jelzés" },
  { group: "candidate", title: "Hiba € 5 jelzés" },
  { group: "candidate", title: "Hiba — 12:30-kor" },
];

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const issues: { candidate: Candidate; number: number; id: string }[] = [];
const rows: Record<string, unknown>[] = [];

function decodeEntities(html: string): string {
  return html
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number(dec)))
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&amp;", "&");
}

try {
  for (const candidate of candidates) {
    const reply = await target.github("POST", target.path("/issues"), {
      token: bot,
      json: { title: candidate.title, body: "Title alphabet check (ticket #32). Safe to ignore." },
    });
    if (reply.status !== 201) {
      console.error(
        `cannot create ${JSON.stringify(candidate.title)}: ${reply.status} ${reply.text}`,
      );
      continue;
    }
    issues.push({ candidate, number: reply.json.number, id: reply.json.node_id });
    await sleep(900);
  }
  await sleep(4000);

  // GraphQL, in batches of 25 aliases.
  const rendered = new Map<number, { title: string; titleHTML: string }>();
  for (let start = 0; start < issues.length; start += 25) {
    const batch = issues.slice(start, start + 25);
    const query = `query { repository(owner: "${target.org}", name: "${target.repo}") { ${batch
      .map(({ number }) => `i${number}: issue(number: ${number}) { title titleHTML }`)
      .join(" ")} } }`;
    const reply = await target.github("POST", "/graphql", { token: bot, json: { query } });
    if (reply.status !== 200 || reply.json.errors)
      throw new Error(`GraphQL: ${reply.text.slice(0, 400)}`);
    for (const { number } of batch) rendered.set(number, reply.json.data.repository[`i${number}`]);
  }

  for (const { candidate, number } of issues) {
    const rest = await target.github("GET", target.path(`/issues/${number}`), { token: bot });
    const timeline = await target.github("GET", target.path(`/issues/${number}/timeline`), {
      token: bot,
    });
    const events = (timeline.json as { event: string }[])
      .map((event) => event.event)
      .filter((event) => !["labeled", "commented"].includes(event));
    const html = rendered.get(number)?.titleHTML ?? "";
    const length = [...candidate.title].length;
    const trimmed = candidate.title.trim();
    rows.push({
      group: candidate.group,
      title: candidate.title,
      allowed: TITLE_ALPHABET.test(trimmed) && length >= MIN_TITLE && length <= MAX_TITLE,
      restKept: rest.json.title === candidate.title,
      graphqlKept: rendered.get(number)?.title === candidate.title,
      titleHTML: html,
      // Plain text means the rendering is the title, HTML-escaped, and nothing else.
      markup: /<[a-z!/]/i.test(html),
      textSurvives: decodeEntities(html.replace(/<[^>]*>/g, "")) === candidate.title,
      events,
    });
  }
} finally {
  for (const { number } of issues) {
    await target.github("PATCH", target.path(`/issues/${number}`), {
      token: bot,
      json: { state: "closed", state_reason: "not_planned" },
    });
  }
}

const out = process.argv[2];
if (out) writeFileSync(out, `${JSON.stringify(rows, null, 2)}\n`);

for (const row of rows) {
  const flags = [
    row["allowed"] ? "ALLOWED" : "rejected",
    row["restKept"] ? "" : "REST-CHANGED",
    row["markup"] ? "MARKUP" : "",
    row["textSurvives"] ? "" : "TEXT-CHANGED",
    (row["events"] as string[]).length > 0 ? `events=${(row["events"] as string[]).join("+")}` : "",
  ]
    .filter(Boolean)
    .join(" ");
  console.log(
    `${String(row["group"]).padEnd(12)} ${JSON.stringify(row["title"]).padEnd(60)} ${flags}`,
  );
}
const bad = rows.filter(
  (row) =>
    row["allowed"] &&
    (!row["restKept"] ||
      row["markup"] ||
      !row["textSurvives"] ||
      (row["events"] as string[]).length > 0),
);
console.log(
  `\n${rows.length} titles, ${rows.filter((row) => row["allowed"]).length} allowed, ${bad.length} allowed ones misbehave`,
);
process.exit(bad.length === 0 ? 0 : 2);
