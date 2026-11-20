// `npm run doctor`: what this machine can carry, and what to run on it.
//
// A red `verify` on a loaded box is the expensive mistake in this repository: the recorded runs took 823s
// instead of 241s, and `test:e2e` and `test:visual` failed in ways that look exactly like product bugs. This
// prints the three numbers those runs depended on — processors, free memory, and whoever else is eating the
// machine — so a slow suite can be attributed before an hour is spent on it. Read-only: it changes nothing.
import { execFileSync } from "node:child_process";
import { cpus, freemem, totalmem } from "node:os";
import { defaultJobLimit } from "./lib/jobs.ts";

interface Busy {
  name: string;
  percent: number;
}

function windowsBusy(): Busy[] {
  const script =
    "Get-CimInstance Win32_PerfFormattedData_PerfProc_Process | " +
    "Sort-Object PercentProcessorTime -Descending | Select-Object -First 6 Name,PercentProcessorTime | " +
    "ConvertTo-Json -Compress";
  const parsed: unknown = JSON.parse(
    execFileSync("powershell", ["-NoProfile", "-Command", script], {
      encoding: "utf8",
      timeout: 30_000,
    }),
  );
  const rows: unknown[] = Array.isArray(parsed) ? parsed : [parsed];
  return rows.flatMap((row) => {
    const name = (row as { Name?: unknown }).Name;
    const percent = (row as { PercentProcessorTime?: unknown }).PercentProcessorTime;
    return typeof name === "string" && typeof percent === "number" ? [{ name, percent }] : [];
  });
}

function posixBusy(): Busy[] {
  const output = execFileSync("ps", ["-eo", "pcpu=,comm=", "--sort=-pcpu"], {
    encoding: "utf8",
    timeout: 30_000,
  });
  return output
    .trim()
    .split("\n")
    .slice(0, 6)
    .flatMap((line) => {
      const match = /^\s*([\d.]+)\s+(.+)$/.exec(line);
      return match ? [{ name: match[2] as string, percent: Number(match[1]) }] : [];
    });
}

function busyProcesses(): Busy[] {
  try {
    const busy = process.platform === "win32" ? windowsBusy() : posixBusy();
    // The aggregate rows are not processes, and they crowd out the six that are.
    return busy.filter(({ name }) => name !== "_Total" && name !== "Idle");
  } catch (error) {
    // A missing `ps`, or a locked-down PowerShell: say so, because an empty list reads as an idle machine.
    console.log(`  (could not read the process list: ${(error as Error).message})`);
    return [];
  }
}

const processors = cpus().length;
const freeGb = freemem() / 1024 ** 3;
const totalGb = totalmem() / 1024 ** 3;
const jobs = defaultJobLimit(processors);

console.log(
  `this machine: ${processors} logical processors, ${freeGb.toFixed(1)} GB free of ${totalGb.toFixed(1)} GB`,
);

const busy = busyProcesses();
if (busy.length > 0) {
  console.log("busiest processes (a Defender scan or an installer is the usual surprise):");
  for (const { name, percent } of busy) console.log(`  ${String(percent).padStart(3)}%  ${name}`);
}

console.log(
  [
    "",
    `verify: up to ${jobs} steps at once (VERIFY_JOBS overrides it, and the two browser suites never overlap).`,
    freeGb < 3
      ? "  Little memory free: a browser suite that fails now may be this machine. Re-run the journey alone first:\n" +
        "  npm run test:e2e -- <spec> --workers=1"
      : "  Room for the full loop.",
  ].join("\n"),
);
