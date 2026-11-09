import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { dropStatus, setDimension } from "./labels.ts";

describe("setDimension", () => {
  it("swaps only its own dimension and keeps every other label", () => {
    expect(
      setDimension(
        ["category:plumbing", "priority:high", "status:new", "stray"],
        "priority",
        "low",
      ),
    ).toEqual(["category:plumbing", "status:new", "stray", "priority:low"]);
  });

  it("repairs a Status that is missing, doubled or obsolete: exactly one remains", () => {
    expect(setDimension(["category:plumbing"], "status", "new")).toEqual([
      "category:plumbing",
      "status:new",
    ]);
    expect(setDimension(["status:new", "status:in-progress"], "status", "done")).toEqual([
      "status:done",
    ]);
    expect(setDimension(["status:retired"], "status", "new")).toEqual(["status:new"]);
  });

  it("never touches a label that merely starts like a dimension", () => {
    expect(setDimension(["statuses:x", "status-new"], "status", "new")).toEqual([
      "statuses:x",
      "status-new",
      "status:new",
    ]);
  });

  it("leaves exactly one label of the dimension and every other label, for any input", () => {
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom("status:a", "status:b", "priority:low", "category:x", "other")),
        (labels) => {
          const next = setDimension(labels, "status", "c");
          expect(next.filter((name) => name.startsWith("status:"))).toEqual(["status:c"]);
          expect(next.filter((name) => !name.startsWith("status:"))).toEqual(
            labels.filter((name) => !name.startsWith("status:")),
          );
        },
      ),
    );
  });
});

describe("dropStatus", () => {
  it("removes every Status label and nothing else", () => {
    expect(dropStatus(["status:new", "status:x", "priority:high"])).toEqual(["priority:high"]);
  });
});
