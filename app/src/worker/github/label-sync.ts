import { DIMENSIONS, labelName, type Taxonomy } from "@shared/config/schema.ts";
import type { LabelSync } from "@shared/api/endpoints.ts";
import type { BotClient } from "./bot-client.ts";

/** The fixed neutral grey of a value with no colour (SPEC 2.3). */
export const NEUTRAL_LABEL_COLOR = "ededed";

interface RepoLabel {
  name: string;
  color: string;
}

/**
 * The taxonomy sync (SPEC 2.3, ADR 0002), one way: the Bot creates every `dimension:value` label that is missing,
 * in the configured colour, and recolours an existing one whose colour differs. It never deletes or renames a
 * label (they carry only the identifier), so a value removed from the configuration simply stops being managed.
 * Idempotent: a second run with the same configuration changes nothing.
 */
export async function syncLabels(bot: BotClient, taxonomy: Taxonomy): Promise<LabelSync> {
  const existing = new Map(
    (await bot.paginate<RepoLabel>(bot.repoPath("/labels"))).map((label) => [
      label.name.toLowerCase(),
      label,
    ]),
  );
  const created: string[] = [];
  const recoloured: string[] = [];
  for (const dimension of DIMENSIONS) {
    for (const value of taxonomy[dimension]) {
      const name = labelName(dimension, value.id);
      const color = (value.color ?? NEUTRAL_LABEL_COLOR).toLowerCase();
      const current = existing.get(name.toLowerCase());
      if (!current) {
        await bot.request("POST", bot.repoPath("/labels"), { body: { name, color } });
        created.push(name);
      } else if (current.color.toLowerCase() !== color) {
        await bot.request("PATCH", bot.repoPath(`/labels/${encodeURIComponent(current.name)}`), {
          body: { color },
        });
        recoloured.push(name);
      }
    }
  }
  return { created, recoloured };
}
