import type { StatusView } from "@shared/status/view.ts";

/**
 * The Status view's 30 second cache, per token, in the Workers Cache API: no KV writes (SPEC 4.3, 4.5). The key is a
 * synthetic URL on a reserved host, so it can never collide with a real request. Eviction is per data centre and
 * best-effort, which the design accepts.
 */
const TTL_SECONDS = 30;

const keyFor = (token: string) =>
  new Request(`https://status-cache.invalid/${encodeURIComponent(token)}`);

export async function readCachedView(token: string): Promise<StatusView | null> {
  const hit = await caches.default.match(keyFor(token));
  return hit ? await hit.json<StatusView>() : null;
}

export function cacheView(token: string, view: StatusView): Promise<void> {
  return caches.default.put(
    keyFor(token),
    Response.json(view, { headers: { "cache-control": `max-age=${TTL_SECONDS}` } }),
  );
}

export async function evictView(token: string): Promise<void> {
  await caches.default.delete(keyFor(token));
}
