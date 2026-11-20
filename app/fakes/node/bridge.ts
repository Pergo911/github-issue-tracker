import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import type { World } from "../world.ts";

/**
 * Serves a world over real HTTP on loopback (127.0.0.1): what the dev server, the end-to-end tests and the
 * `world` command talk to. The Worker (in workerd) and the SPA (in a browser) reach the fakes through this
 * server, so the whole local world is `vite dev`.
 */
export interface Bridge {
  /** `http://127.0.0.1:<port>`: append `/github`, `/github-web`, `/resend` or `/control`. */
  url: string;
  port: number;
  close(): Promise<void>;
}

function toRequest(
  incoming: IncomingMessage,
  body: Buffer,
  signal: AbortSignal,
  origin: string,
): Request {
  const headers = new Headers();
  for (const [name, value] of Object.entries(incoming.headers)) {
    if (value === undefined) continue;
    for (const entry of Array.isArray(value) ? value : [value]) headers.append(name, entry);
  }
  const method = incoming.method ?? "GET";
  return new Request(`${origin}${incoming.url ?? "/"}`, {
    method,
    headers,
    signal,
    ...(method === "GET" || method === "HEAD" || body.length === 0
      ? {}
      : { body: new Uint8Array(body) }),
  });
}

async function respond(
  world: World,
  incoming: IncomingMessage,
  outgoing: ServerResponse,
  origin: string,
) {
  const chunks: Buffer[] = [];
  for await (const chunk of incoming) chunks.push(chunk as Buffer);
  const aborter = new AbortController();
  // A caller that gives up (a timeout) closes the connection before it was answered: the fake sees an abort.
  outgoing.on("close", () => {
    if (!outgoing.writableEnded) aborter.abort();
  });
  try {
    const response = await world.handle(
      toRequest(incoming, Buffer.concat(chunks), aborter.signal, origin),
    );
    const headers: Record<string, string> = {};
    response.headers.forEach((value, name) => {
      headers[name] = value;
    });
    outgoing.writeHead(response.status, headers);
    outgoing.end(Buffer.from(await response.arrayBuffer()));
  } catch {
    // A lost response or an abort: drop the connection without answering, as a failing network would.
    incoming.socket.destroy();
  }
}

export async function startBridge(world: World, port = 0): Promise<Bridge> {
  const server: Server = createServer((incoming, outgoing) => {
    const origin = `http://${incoming.headers.host ?? "127.0.0.1"}`;
    void respond(world, incoming, outgoing, origin);
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  const actual = (server.address() as AddressInfo).port;
  return {
    url: `http://127.0.0.1:${actual}`,
    port: actual,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
