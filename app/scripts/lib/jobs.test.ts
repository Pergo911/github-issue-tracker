import { describe, expect, it } from "vitest";
import {
  defaultJobLimit,
  defaultPlaywrightWorkers,
  hasWorkersFlag,
  jobLimit,
  playwrightWorkers,
} from "./jobs.ts";

describe("defaultJobLimit", () => {
  it("gives a small CI runner fewer steps at once than the old constant of five", () => {
    // The recorded failure: test:visual 891s and test:e2e 830s, both failed, on a 4-vCPU ubuntu-latest runner.
    expect(defaultJobLimit(4)).toBe(2);
  });

  it("never exceeds four, however large the machine", () => {
    expect(defaultJobLimit(22)).toBe(4);
    expect(defaultJobLimit(128)).toBe(4);
  });

  it("never drops below one, even where the CPU count is reported as one", () => {
    expect(defaultJobLimit(1)).toBe(1);
    expect(defaultJobLimit(0)).toBe(1);
  });
});

describe("jobLimit", () => {
  it("takes VERIFY_JOBS when it is a positive whole number", () => {
    expect(jobLimit("2", 22)).toBe(2);
    expect(jobLimit("1", 22)).toBe(1);
    expect(jobLimit("9", 22)).toBe(9);
  });

  it("falls back to the machine's limit for an unset, empty or nonsensical value", () => {
    expect(jobLimit(undefined, 22)).toBe(4);
    expect(jobLimit("", 22)).toBe(4);
    expect(jobLimit("0", 22)).toBe(4);
    expect(jobLimit("-2", 22)).toBe(4);
    expect(jobLimit("two", 22)).toBe(4);
    expect(jobLimit("2.5", 22)).toBe(4);
  });
});

describe("defaultPlaywrightWorkers", () => {
  it("matches the runner's CPU count on small CI runners", () => {
    expect(defaultPlaywrightWorkers(2)).toBe(2);
    expect(defaultPlaywrightWorkers(3)).toBe(3);
  });

  it("caps at four on larger machines so parallel browsers do not thrash memory", () => {
    expect(defaultPlaywrightWorkers(4)).toBe(4);
    expect(defaultPlaywrightWorkers(22)).toBe(4);
  });

  it("never drops below one", () => {
    expect(defaultPlaywrightWorkers(1)).toBe(1);
    expect(defaultPlaywrightWorkers(0)).toBe(1);
  });
});

describe("playwrightWorkers", () => {
  it("takes an explicit positive whole number over the machine default", () => {
    expect(playwrightWorkers("1", 22)).toBe(1);
    expect(playwrightWorkers("6", 2)).toBe(6);
  });

  it("falls back to the machine default when unset or invalid", () => {
    expect(playwrightWorkers(undefined, 2)).toBe(2);
    expect(playwrightWorkers("", 22)).toBe(4);
    expect(playwrightWorkers("0", 22)).toBe(4);
    expect(playwrightWorkers("-1", 22)).toBe(4);
    expect(playwrightWorkers("fast", 22)).toBe(4);
  });
});

describe("hasWorkersFlag", () => {
  it("detects long and short Playwright worker flags", () => {
    expect(hasWorkersFlag(["--workers", "1"])).toBe(true);
    expect(hasWorkersFlag(["--workers=2"])).toBe(true);
    expect(hasWorkersFlag(["-j", "1"])).toBe(true);
    expect(hasWorkersFlag(["-j=2"])).toBe(true);
    expect(hasWorkersFlag(["-j2"])).toBe(true);
  });

  it("ignores unrelated flags", () => {
    expect(hasWorkersFlag([])).toBe(false);
    expect(hasWorkersFlag(["-g", "home", "--shard=1/2"])).toBe(false);
  });
});
