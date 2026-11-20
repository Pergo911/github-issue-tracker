import { describe, expect, it } from "vitest";
import { liveTarget, SANDBOX_REPO } from "./target.ts";

describe("liveTarget sandbox guard", () => {
  const target = liveTarget({
    org: "example-org",
    appId: 1,
    installationId: 2,
    staffClientId: "Iv1.test",
    privateKey: "unused",
    operatorToken: "unused",
  });

  it("refuses any request naming a repo other than reports-sandbox before sending it", async () => {
    await expect(target.github("GET", "/repos/example-org/reports/issues")).rejects.toThrow(
      `only touches ${SANDBOX_REPO}, not reports`,
    );
    await expect(
      target.github("PATCH", "https://api.github.com/repos/example-org/reports/issues/1", {
        json: { state: "closed" },
      }),
    ).rejects.toThrow(`only touches ${SANDBOX_REPO}, not reports`);
  });

  it("targets reports-sandbox in path()", () => {
    expect(target.repo).toBe(SANDBOX_REPO);
    expect(target.path("/issues")).toBe(`/repos/example-org/${SANDBOX_REPO}/issues`);
  });
});
