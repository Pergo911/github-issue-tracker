/**
 * Validation of the Submission form's fields (SPEC 4.1). Runtime-neutral: the SPA uses it for its length hints
 * and inline errors, the Worker is authoritative. Failures are stable codes (`form.error.<code>` in the
 * catalog), never messages.
 */

export const MIN_TITLE = 3;
export const MAX_TITLE = 80;
export const MAX_DESCRIPTION = 4000;
export const MAX_PLACE = 100;

/** Unicode letters, combining marks, numbers, the ordinary space and `. , ! ? ( ) ' " - – — ‘ ’ “ ”`. */
export const TITLE_ALPHABET = /^[\p{L}\p{M}\p{N} .,!?()'"\-–—‘’“”]*$/u;

export const FIELD_ERRORS = [
  "title_length",
  "title_characters",
  "description_length",
  "place_length",
  "unknown_category",
  "unknown_location",
] as const;
export type FieldError = (typeof FIELD_ERRORS)[number];

export interface ReportFields {
  category: string;
  location: string;
  title: string;
  description: string;
  place?: string;
}

export interface FieldTaxonomy {
  categories: readonly string[];
  locations: readonly string[];
}

export type FieldValidation = { ok: true; fields: ReportFields } | { ok: false; error: FieldError };

/** Trim, then collapse internal newlines to single spaces (the title is one line). */
export function normalizeTitle(raw: string): string {
  return raw.replace(/\s*[\r\n]+\s*/g, " ").trim();
}

/** Trimmed and lowercased; no dot or `+tag` folding, so matching is exact (SPEC 5). */
export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

const length = (text: string) => [...text].length;

export type FieldName = "category" | "location" | "title" | "description" | "place";

export interface FieldInput {
  category: string;
  location: string;
  title: string;
  description: string;
  place?: string | undefined;
}

/** Every problem at once, one code per field, for the form's inline errors. Never strips or replaces characters. */
export function collectErrors(
  input: FieldInput,
  taxonomy: FieldTaxonomy,
): Partial<Record<FieldName, FieldError>> {
  const errors: Partial<Record<FieldName, FieldError>> = {};
  if (!taxonomy.categories.includes(input.category)) errors.category = "unknown_category";
  if (!taxonomy.locations.includes(input.location)) errors.location = "unknown_location";

  const title = normalizeTitle(input.title);
  if (length(title) < MIN_TITLE || length(title) > MAX_TITLE) errors.title = "title_length";
  else if (!TITLE_ALPHABET.test(title)) errors.title = "title_characters";

  const description = input.description.trim();
  if (length(description) < 1 || length(description) > MAX_DESCRIPTION) {
    errors.description = "description_length";
  }
  if (length(input.place?.trim() ?? "") > MAX_PLACE) errors.place = "place_length";
  return errors;
}

/** The first problem, in form order, or the normalized fields. */
export function validateFields(input: FieldInput, taxonomy: FieldTaxonomy): FieldValidation {
  const errors = collectErrors(input, taxonomy);
  const order: FieldName[] = ["category", "location", "title", "description", "place"];
  for (const name of order) {
    const error = errors[name];
    if (error) return { ok: false, error };
  }
  const place = input.place?.trim() ?? "";
  return {
    ok: true,
    fields: {
      category: input.category,
      location: input.location,
      title: normalizeTitle(input.title),
      description: input.description.trim(),
      ...(place === "" ? {} : { place }),
    },
  };
}
