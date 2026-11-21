import { describe, expect, it } from "vitest";
import { activeServerKinds, SERVER_KINDS } from "./servers.ts";

describe("activeServerKinds", () => {
  it("defaults to all three servers when E2E_SERVERS is unset or blank", () => {
    expect(activeServerKinds({})).toEqual(SERVER_KINDS);
    expect(activeServerKinds({ E2E_SERVERS: "" })).toEqual(SERVER_KINDS);
  });

  it("returns only the requested server kinds in order", () => {
    expect(activeServerKinds({ E2E_SERVERS: "seeded,empty" })).toEqual(["seeded", "empty"]);
    expect(activeServerKinds({ E2E_SERVERS: "seeded" })).toEqual(["seeded"]);
  });

  it("rejects an unknown server kind", () => {
    expect(() => activeServerKinds({ E2E_SERVERS: "seeded,bogus" })).toThrow(/bogus/);
  });
});
