// `npm run world -- <method> [argument ...]`: drive the local world a running `npm run dev` hosts (the fake GitHub
// and the fake Resend). Every method of the control API works; arguments are JSON where they parse, else text.
//
//   npm run world -- summary                              what is in the world, with the tokens of its Staff users
//   npm run world -- seed                                 Appendix A labels, Staff users per role, a few Reports
//   npm run world -- deviceCodes                          the codes the sign-in screen is showing
//   npm run world -- approveDeviceCode ABCD-EFGH mate-maintenance
//   npm run world -- outbox                               the mail the Worker sent (read the OTP here)
//   npm run world -- latestMailTo resident@example.hu
//   npm run world -- addFault '{"service":"github","effect":{"type":"status","status":503}}'
//   npm run world -- reset
import { connectWorld, parseCommand } from "./lib/world.ts";

try {
  const { method, args } = parseCommand(process.argv.slice(2));
  const { control } = connectWorld();
  const method_ = (control as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>)[
    method
  ];
  if (typeof method_ !== "function") throw new Error(`Unknown control method "${method}"`);
  const result = await method_(...args);
  console.log(JSON.stringify(result ?? null, null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
