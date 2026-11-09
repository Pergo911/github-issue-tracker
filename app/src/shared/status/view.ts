import { z } from "zod";
import { DIMENSIONS, LANGUAGES, type Dimension, type Taxonomy } from "../config/schema.ts";
import type { GitHubIssue, GitHubTimelineEvent } from "../github/types.ts";
import { catalogFor, createTranslator } from "../i18n/index.ts";
import { classifyComment, type ExpectedBot } from "../reports/attribution.ts";
import { buildReportBody } from "../reports/body.ts";

/**
 * The Status page's public projection of a Report (SPEC 4.3, "Status-page field allowlist"). It is built
 * field by field from what the Bot read, never by deleting keys from a GitHub object, so a field GitHub adds
 * later is private by default. `statusViewSchema` is the same allowlist as a strict schema: a test proves a
 * built view parses under it and that nothing else gets through. Runtime-neutral: the Worker builds it, the SPA
 * only receives it. Display names and colours are not in it: the SPA takes them from the public configuration.
 */

export const CLOSE_REASONS = ["fixed", "rejected", "duplicate"] as const;
export type CloseReason = (typeof CLOSE_REASONS)[number];

const isoTime = z.string().min(1);

const timelineItemSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("comment"),
    author: z.enum(["reporter", "staff"]),
    text: z.string(),
    at: isoTime,
  }),
  z.strictObject({ kind: z.literal("status"), id: z.string(), at: isoTime }),
  z.strictObject({ kind: z.literal("category"), id: z.string(), at: isoTime }),
  z.strictObject({ kind: z.literal("location"), id: z.string(), at: isoTime }),
  z.strictObject({ kind: z.literal("closed"), reason: z.enum(CLOSE_REASONS), at: isoTime }),
  z.strictObject({ kind: z.literal("reopened"), at: isoTime }),
  z.strictObject({ kind: z.literal("assigned"), at: isoTime }),
  z.strictObject({ kind: z.literal("unassigned"), at: isoTime }),
]);

const bodySchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("report"),
    place: z.string().nullable(),
    description: z.string(),
  }),
  z.strictObject({ kind: z.literal("plain"), text: z.string() }),
]);

export const statusViewSchema = z.strictObject({
  number: z.int(),
  title: z.string(),
  body: bodySchema,
  state: z.enum(["open", "closed"]),
  /** Only for a closed Report. */
  closeReason: z.enum(CLOSE_REASONS).nullable(),
  /** A configured Status id; `null` is the "Awaiting status update" fallback (and always null once closed). */
  status: z.string().nullable(),
  category: z.string().nullable(),
  location: z.string().nullable(),
  /** Whether anyone is assigned: never who. */
  assigned: z.boolean(),
  createdAt: isoTime,
  updatedAt: isoTime,
  closedAt: isoTime.nullable(),
  timeline: z.array(timelineItemSchema),
});

export type StatusView = z.infer<typeof statusViewSchema>;
export type StatusTimelineItem = StatusView["timeline"][number];
export type StatusBody = StatusView["body"];

export function closeReasonOf(reason: string | null | undefined): CloseReason {
  if (reason === "not_planned") return "rejected";
  if (reason === "duplicate") return "duplicate";
  return "fixed";
}

function parseLabel(name: string): { dimension: Dimension; id: string } | null {
  const colon = name.indexOf(":");
  if (colon === -1) return null;
  const dimension = DIMENSIONS.find((candidate) => candidate === name.slice(0, colon));
  return dimension ? { dimension, id: name.slice(colon + 1) } : null;
}

const isConfigured = (taxonomy: Taxonomy, dimension: Dimension, id: string) =>
  taxonomy[dimension].some((value) => value.id === id);

/** The single configured Status of an open Report; `null` for none, several or an obsolete one. */
function currentStatus(issue: GitHubIssue, taxonomy: Taxonomy): string | null {
  if (issue.state === "closed") return null;
  const found = issue.labels
    .map((label) => parseLabel(label.name))
    .filter((parsed) => parsed?.dimension === "status");
  if (found.length !== 1) return null;
  const id = found[0]?.id ?? "";
  return isConfigured(taxonomy, "status", id) ? id : null;
}

function currentValue(
  issue: GitHubIssue,
  taxonomy: Taxonomy,
  dimension: "category" | "location",
): string | null {
  for (const label of issue.labels) {
    const parsed = parseLabel(label.name);
    if (parsed?.dimension === dimension && isConfigured(taxonomy, dimension, parsed.id)) {
      return parsed.id;
    }
  }
  return null;
}

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const MARKER_LINE = /\n*<!-- fault-report-attempt:[^>]*-->[ \t]*/g;

/** The part of a fenced field that starts at `start`: its text and where the line after the fence begins. */
function readFence(source: string, start: number): { text: string; end: number } | null {
  const opening = /^`+/.exec(source.slice(start))?.[0].length ?? 0;
  if (opening < 3 || source[start + opening] !== "\n") return null;
  const closing = source.indexOf(`\n${"`".repeat(opening)}`, start + opening + 1);
  if (closing === -1) return null;
  return {
    text: source.slice(start + opening + 1, closing),
    end: closing + 1 + opening,
  };
}

/**
 * Reads a Report body the Bot wrote (SPEC 4.1): the Exact place and the description. Accepts a body only
 * when re-encoding what was read gives back exactly the same text, so a Staff edit or a hand-made lookalike
 * is never half-decoded. Tries each shipped language, since the captions are in the language the Report was
 * filed in.
 */
function decodeReportBody(raw: string): { place: string | null; description: string } | null {
  for (const language of LANGUAGES) {
    const t = createTranslator(catalogFor(language));
    const heading = new RegExp(
      `^\\*\\*${escapeRegExp(t("report.body.category"))}:\\*\\* ([^\\n]*)\\n\\*\\*${escapeRegExp(
        t("report.body.location"),
      )}:\\*\\* ([^\\n]*)\\n\\n`,
    ).exec(raw);
    if (!heading) continue;
    const [prefix, categoryName = "", locationName = ""] = heading;
    let position = prefix.length;
    let place: string | undefined;
    const placeCaption = `**${t("report.body.place")}:**\n`;
    if (raw.startsWith(placeCaption, position)) {
      const fence = readFence(raw, position + placeCaption.length);
      if (!fence || raw.slice(fence.end, fence.end + 2) !== "\n\n") continue;
      place = fence.text;
      position = fence.end + 2;
    }
    const descriptionCaption = `**${t("report.body.description")}:**\n`;
    if (!raw.startsWith(descriptionCaption, position)) continue;
    const fence = readFence(raw, position + descriptionCaption.length);
    if (!fence) continue;
    const marker = /^\n\n<!-- fault-report-attempt: ([A-Za-z0-9_-]+) -->$/.exec(
      raw.slice(fence.end),
    )?.[1];
    if (marker === undefined) continue;
    const rebuilt = buildReportBody({
      t,
      categoryName,
      locationName,
      place,
      description: fence.text,
      marker,
    });
    if (rebuilt === raw) return { place: place ?? null, description: fence.text };
  }
  return null;
}

function bodyOf(issue: GitHubIssue, bot: ExpectedBot): StatusBody {
  const raw = issue.body ?? "";
  const byBot =
    issue.user.login === bot.login && issue.user.id === bot.id && issue.user.type === "Bot";
  const decoded = byBot ? decodeReportBody(raw) : null;
  if (decoded) return { kind: "report", place: decoded.place, description: decoded.description };
  // Neither the correlation marker nor anything machine-made leaves with the plain text.
  return { kind: "plain", text: raw.replace(MARKER_LINE, "").trimEnd() };
}

export function buildStatusView(input: {
  issue: GitHubIssue;
  /** The whole timeline, every page, in GitHub's order. */
  timeline: readonly GitHubTimelineEvent[];
  taxonomy: Taxonomy;
  bot: ExpectedBot;
}): StatusView {
  const { issue, taxonomy, bot } = input;
  const closed = issue.state === "closed";

  const timeline: StatusTimelineItem[] = [];
  let assignees = 0;
  for (const event of input.timeline) {
    switch (event.event) {
      case "commented": {
        const { author, text } = classifyComment(event, bot);
        timeline.push({ kind: "comment", author, text, at: event.created_at });
        break;
      }
      case "labeled": {
        const parsed = parseLabel(event.label.name);
        if (
          parsed &&
          (parsed.dimension === "status" ||
            parsed.dimension === "category" ||
            parsed.dimension === "location") &&
          isConfigured(taxonomy, parsed.dimension, parsed.id)
        ) {
          timeline.push({ kind: parsed.dimension, id: parsed.id, at: event.created_at });
        }
        break;
      }
      case "closed":
        timeline.push({
          kind: "closed",
          reason: closeReasonOf(event.state_reason),
          at: event.created_at,
        });
        break;
      case "reopened":
        timeline.push({ kind: "reopened", at: event.created_at });
        break;
      case "assigned":
        assignees += 1;
        if (assignees === 1) timeline.push({ kind: "assigned", at: event.created_at });
        break;
      case "unassigned":
        assignees = Math.max(0, assignees - 1);
        if (assignees === 0) timeline.push({ kind: "unassigned", at: event.created_at });
        break;
      default:
        // `unlabeled`, `renamed` and anything GitHub adds later are not part of the allowlist.
        break;
    }
  }

  return {
    number: issue.number,
    title: issue.title,
    body: bodyOf(issue, bot),
    state: closed ? "closed" : "open",
    closeReason: closed ? closeReasonOf(issue.state_reason) : null,
    status: currentStatus(issue, taxonomy),
    category: currentValue(issue, taxonomy, "category"),
    location: currentValue(issue, taxonomy, "location"),
    assigned: issue.assignees.length > 0,
    createdAt: issue.created_at,
    updatedAt: issue.updated_at,
    closedAt: closed ? issue.closed_at : null,
    timeline,
  };
}
