/** Small web-standard HTTP helpers shared by both fakes: a path router and response builders. */

export interface RouteContext {
  request: Request;
  url: URL;
  /** Path parameters, already percent-decoded. */
  params: Record<string, string>;
  /** The path below the service prefix, e.g. `/repos/o/r/issues`. */
  path: string;
}

export type RouteHandler = (context: RouteContext) => Response | Promise<Response>;

interface Route {
  method: string;
  segments: string[];
  handler: RouteHandler;
}

/** Matches `/a/:param/b` patterns; the first matching route wins. */
export class Router {
  readonly #routes: Route[] = [];

  add(method: string, pattern: string, handler: RouteHandler): void {
    this.#routes.push({ method, segments: pattern.split("/").filter(Boolean), handler });
  }

  /** The handler and parameters for a request, `"method"` when only the method is wrong, else `null`. */
  match(
    method: string,
    path: string,
  ): { handler: RouteHandler; params: Record<string, string> } | "method" | null {
    const segments = path.split("/").filter(Boolean);
    let pathMatched = false;
    for (const route of this.#routes) {
      if (route.segments.length !== segments.length) continue;
      const params: Record<string, string> = {};
      let ok = true;
      for (let index = 0; index < segments.length; index++) {
        const pattern = route.segments[index] as string;
        const actual = segments[index] as string;
        if (pattern.startsWith(":")) {
          try {
            params[pattern.slice(1)] = decodeURIComponent(actual);
          } catch {
            ok = false;
            break;
          }
        } else if (pattern !== actual) {
          ok = false;
          break;
        }
      }
      if (!ok) continue;
      pathMatched = true;
      if (route.method === method) return { handler: route.handler, params };
    }
    return pathMatched ? "method" : null;
  }
}

export function jsonResponse(
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...headers },
  });
}

/** Reads a request's JSON body. `undefined` for an empty body, `"invalid"` for text that is not JSON. */
export async function readJson(request: Request): Promise<unknown> {
  const text = await request.text();
  if (text.trim() === "") return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return "invalid";
  }
}

/** `{ "a": "b" }` from a form-encoded or JSON body: the OAuth endpoints accept both. */
export async function readFormOrJson(
  request: Request,
): Promise<Record<string, unknown> | "invalid"> {
  const text = await request.text();
  if (text.trim() === "") return {};
  if ((request.headers.get("content-type") ?? "").includes("json")) {
    try {
      const parsed: unknown = JSON.parse(text);
      return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : "invalid";
    } catch {
      return "invalid";
    }
  }
  return Object.fromEntries(new URLSearchParams(text));
}

/**
 * `page` and `per_page` pagination with GitHub's `Link` header (absolute URLs on the URL the client called, so
 * a client that follows `rel="next"` verbatim stays on the same fake). Returns the slice and the header.
 */
export function paginate<T>(
  url: URL,
  items: readonly T[],
  options: { defaultPerPage?: number; maxPerPage?: number } = {},
): { page: T[]; link: string | null } {
  const maxPerPage = options.maxPerPage ?? 100;
  const perPage = Math.min(
    Math.max(1, Number(url.searchParams.get("per_page")) || options.defaultPerPage || 30),
    maxPerPage,
  );
  const pageNumber = Math.max(1, Number(url.searchParams.get("page")) || 1);
  const lastPage = Math.max(1, Math.ceil(items.length / perPage));
  const page = items.slice((pageNumber - 1) * perPage, pageNumber * perPage);

  const link = (target: number, rel: string) => {
    const copy = new URL(url);
    copy.searchParams.set("page", String(target));
    copy.searchParams.set("per_page", String(perPage));
    return `<${copy.toString()}>; rel="${rel}"`;
  };
  const parts: string[] = [];
  if (pageNumber < lastPage) parts.push(link(pageNumber + 1, "next"), link(lastPage, "last"));
  if (pageNumber > 1) parts.push(link(1, "first"), link(pageNumber - 1, "prev"));
  // GitHub orders them next, last, first, prev.
  return { page, link: parts.length > 0 ? parts.join(", ") : null };
}

export function isoSeconds(milliseconds: number): string {
  return new Date(milliseconds).toISOString().replace(/\.\d{3}Z$/, "Z");
}
