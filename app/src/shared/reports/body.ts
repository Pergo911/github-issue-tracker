import type { Translator } from "../i18n/translate.ts";
import { encodeFence } from "./fence.ts";

/**
 * The fixed issue-body template (SPEC 4.1). Captions come from the code catalog in the Deployment's language;
 * the category and location display names are Deployment-authored text; each Reporter-authored field is in the
 * canonical dynamic fence (SPEC 4.3). The correlation marker is trusted machine metadata, outside every fence.
 * No email, credential or Status token ever goes in here.
 */

/** The line a recovery scan looks for (ADR 0005). Not localized. */
export function correlationMarker(marker: string): string {
  return `<!-- fault-report-attempt: ${marker} -->`;
}

export function buildReportBody(input: {
  t: Translator;
  categoryName: string;
  locationName: string;
  place?: string | undefined;
  description: string;
  marker: string;
}): string {
  const { t } = input;
  const lines = [
    `**${t("report.body.category")}:** ${input.categoryName}`,
    `**${t("report.body.location")}:** ${input.locationName}`,
    "",
  ];
  if (input.place !== undefined) {
    lines.push(`**${t("report.body.place")}:**`, encodeFence(input.place), "");
  }
  lines.push(
    `**${t("report.body.description")}:**`,
    encodeFence(input.description),
    "",
    correlationMarker(input.marker),
  );
  return lines.join("\n");
}
