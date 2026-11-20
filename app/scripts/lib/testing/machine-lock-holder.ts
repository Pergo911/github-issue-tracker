// A real process for the lock's crash/recovery test. The parent controls retries, not wall-clock sleeps.
import { acquireMachineLock } from "../machine-lock.ts";

let retry: (() => void) | undefined;
process.on("message", (message: unknown) => {
  if (message === "retry") {
    retry?.();
    retry = undefined;
  } else if (message === "release") {
    lock.release();
    process.disconnect?.();
  }
});
process.on("disconnect", () => process.exit(0));

const path = process.argv[2];
if (path === undefined) throw new Error("The test must supply a lock path.");
const lock = await acquireMachineLock({
  path,
  task: "crash/recovery test",
  report: () => {},
  sleep: () =>
    new Promise<void>((resolve) => {
      retry = resolve;
      process.send?.("waiting");
    }),
});
process.send?.("held");
