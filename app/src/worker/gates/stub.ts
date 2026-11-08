/** What every gate answers until its ticket implements it (SPEC 4.5, tickets #23 and #24). */
export function notImplemented(gate: string): Response {
  return new Response(`${gate} is not implemented yet`, { status: 501 });
}
