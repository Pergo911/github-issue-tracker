import { describe, expect, it } from "vitest";
import { defaultJobLimit, jobLimit } from "./jobs.ts";

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
