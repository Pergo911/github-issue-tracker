import { z } from "zod";
import { parseSearchParams } from "@/lib/search-params.ts";

const optionalText = z.string().min(1).max(200).optional().catch(undefined);

const listViewSchema = z.object({
  state: z.enum(["open", "closed"]).catch("open"),
  category: optionalText,
  location: optionalText,
  priority: optionalText,
  status: optionalText,
  assignee: optionalText,
  untriaged: z
    .literal("1")
    .transform(() => true as const)
    .optional()
    .catch(undefined),
  /** Free-text search (GitHub's search API); empty means no search. */
  q: z.string().max(256).catch(""),
});

/** The List's view state: it lives in the URL, so a view can be shared and the back button works (SPEC 2.6). */
export interface ListView {
  state: "open" | "closed";
  category?: string;
  location?: string;
  priority?: string;
  status?: string;
  assignee?: string;
  untriaged?: true;
  q: string;
}

export function parseListView(params: URLSearchParams): ListView {
  const parsed = parseSearchParams(listViewSchema, params);
  const view: ListView = { state: parsed.state, q: parsed.q };
  for (const key of ["category", "location", "priority", "status", "assignee"] as const) {
    const value = parsed[key];
    if (value !== undefined) view[key] = value;
  }
  if (parsed.untriaged) view.untriaged = true;
  return view;
}

/** The URL's parameters for a view; defaults are left out, and `rest` keeps the parameters that are not ours. */
export function listViewToParams(view: ListView, rest?: URLSearchParams): URLSearchParams {
  const params = new URLSearchParams();
  const ours = new Set([
    "state",
    "category",
    "location",
    "priority",
    "status",
    "assignee",
    "untriaged",
    "q",
  ]);
  for (const [key, value] of rest ?? []) {
    if (!ours.has(key)) params.append(key, value);
  }
  if (view.state !== "open") params.set("state", view.state);
  for (const key of ["category", "location", "priority", "status", "assignee"] as const) {
    const value = view[key];
    if (value !== undefined) params.set(key, value);
  }
  if (view.untriaged) params.set("untriaged", "1");
  if (view.q !== "") params.set("q", view.q);
  return params;
}
