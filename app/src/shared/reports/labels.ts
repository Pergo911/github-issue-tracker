import { labelName, type Dimension } from "../config/schema.ts";

/**
 * The label arithmetic of the dashboard's writes (SPEC 2.3, 2.4, 2.6). A `PATCH` replaces a Report's whole label
 * set, so each write computes the new set from the labels GitHub has right now, changes only its own
 * dimension, and sends the result in one call. Runtime-neutral.
 */

/**
 * `labels` with every label of `dimension` (whatever its value: stale, obsolete or conflicting ones too) replaced
 * by `id`, or removed when `id` is `null`. Labels of other dimensions and unrelated labels keep their place.
 */
export function setDimension(
  labels: readonly string[],
  dimension: Dimension,
  id: string | null,
): string[] {
  const prefix = `${dimension}:`;
  const kept = labels.filter((name) => !name.startsWith(prefix));
  return id === null ? kept : [...kept, labelName(dimension, id)];
}

/** Closing drops the Status label in the same call (SPEC 2.4). */
export const dropStatus = (labels: readonly string[]): string[] =>
  setDimension(labels, "status", null);
