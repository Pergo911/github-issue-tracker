import { starterConfig } from "@shared/config/defaults.ts";
import { DIMENSIONS, type Config, type Dimension } from "@shared/config/schema.ts";

/**
 * The Configuration form's state (SPEC 2.4): the stored configuration as editable text, with what the form
 * needs on top of it. A value carries a React `key`, and `saved`: an identifier is fixed once the value exists in
 * the stored configuration (it is the GitHub label's name), but free while the value is only in the draft.
 */

export interface DraftValue {
  key: string;
  id: string;
  name: string;
  /** Six hex digits; empty means "no colour" (the neutral grey). */
  color: string;
  initial: boolean;
  notify: boolean;
  saved: boolean;
}

export interface DraftTemplate {
  subject: string;
  body: string;
}

export interface Draft {
  language: string;
  timezone: string;
  displayName: string;
  emergencyNotice: string;
  codeSentHelp: string;
  taxonomy: Record<Dimension, DraftValue[]>;
  email: {
    senderLocalPart: string;
    senderName: string;
    replyTo: string;
    replyClause: string;
    footer: string;
    templates: Record<keyof Config["email"]["templates"], DraftTemplate>;
  };
  dailyCodeBudget: string;
}

let counter = 0;
const nextKey = () => `value-${(counter += 1)}`;

type Source = Omit<Config, "lastEditor">;

/** The draft of the stored configuration, or of the starter configuration on a fresh Deployment (`null`). */
export function toDraft(config: Source | null): Draft {
  const source: Source = config ?? structuredClone(starterConfig);
  const saved = config !== null;
  const values = (dimension: Dimension): DraftValue[] =>
    source.taxonomy[dimension].map((value) => ({
      key: nextKey(),
      id: value.id,
      name: value.name,
      color: value.color ?? "",
      initial: "initial" in value ? value.initial : false,
      notify: "notify" in value ? value.notify : false,
      saved,
    }));
  return {
    language: source.language,
    timezone: source.timezone,
    displayName: source.displayName,
    emergencyNotice: source.emergencyNotice,
    codeSentHelp: source.codeSentHelp,
    taxonomy: {
      category: values("category"),
      location: values("location"),
      priority: values("priority"),
      status: values("status"),
    },
    email: structuredClone(source.email),
    dailyCodeBudget: String(source.dailyCodeBudget),
  };
}

/** What the Worker validates: the draft as the configuration's JSON. Nothing is checked here. */
export function draftToPayload(draft: Draft): unknown {
  const plain = (value: DraftValue) => ({
    id: value.id,
    name: value.name,
    ...(value.color === "" ? {} : { color: value.color }),
  });
  return {
    language: draft.language,
    timezone: draft.timezone,
    displayName: draft.displayName,
    emergencyNotice: draft.emergencyNotice,
    codeSentHelp: draft.codeSentHelp,
    taxonomy: {
      category: draft.taxonomy.category.map(plain),
      location: draft.taxonomy.location.map(plain),
      priority: draft.taxonomy.priority.map(plain),
      status: draft.taxonomy.status.map((value) => ({
        ...plain(value),
        initial: value.initial,
        notify: value.notify,
      })),
    },
    email: draft.email,
    dailyCodeBudget: draft.dailyCodeBudget.trim() === "" ? null : Number(draft.dailyCodeBudget),
  };
}

export function addValue(list: DraftValue[]): DraftValue[] {
  const none = "";
  return [
    ...list,
    {
      key: nextKey(),
      id: none,
      name: none,
      color: none,
      initial: false,
      notify: false,
      saved: false,
    },
  ];
}

export function removeValue(list: DraftValue[], key: string): DraftValue[] {
  return list.filter((value) => value.key !== key);
}

/** Swaps a value with its neighbour (`-1` up, `1` down); the ends stay put. */
export function moveValue(list: DraftValue[], index: number, direction: -1 | 1): DraftValue[] {
  const target = index + direction;
  if (target < 0 || target >= list.length) return list;
  const next = [...list];
  [next[index], next[target]] = [next[target] as DraftValue, next[index] as DraftValue];
  return next;
}

/** Exactly one Status is initial: choosing one clears the rest. */
export function setInitialStatus(list: DraftValue[], key: string): DraftValue[] {
  return list.map((value) => ({ ...value, initial: value.key === key }));
}

/** A lowercase kebab-case identifier from a display name: accents folded, everything else a hyphen. */
export function slugify(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export const DIMENSION_LIST = DIMENSIONS;
