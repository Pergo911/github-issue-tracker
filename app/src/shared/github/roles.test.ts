import { describe, expect, it } from "vitest";
import { roleAtLeast, roleFromPermissions } from "./roles.ts";

// SPEC 2.4: admin -> System admin; triage, push, maintain -> Maintenance staff; pull -> Viewer; else deny.
describe("roleFromPermissions", () => {
  const read = { admin: false, maintain: false, push: false, triage: false, pull: true };

  it.each([
    ["read", read, "viewer"],
    ["triage", { ...read, triage: true }, "maintenance"],
    ["write", { ...read, triage: true, push: true }, "maintenance"],
    ["maintain", { ...read, triage: true, push: true, maintain: true }, "maintenance"],
    ["admin", { admin: true, maintain: true, push: true, triage: true, pull: true }, "admin"],
  ] as const)("maps the %s role", (_name, permissions, role) => {
    expect(roleFromPermissions(permissions)).toBe(role);
  });

  it("treats a missing triage or maintain flag as false (GitHub only requires admin, pull, push)", () => {
    expect(roleFromPermissions({ admin: false, push: false, pull: true })).toBe("viewer");
    expect(roleFromPermissions({ admin: false, push: true, pull: true })).toBe("maintenance");
  });

  it("denies when there is no permissions object, or none of its flags is set", () => {
    expect(roleFromPermissions(undefined)).toBeNull();
    expect(roleFromPermissions(null)).toBeNull();
    expect(roleFromPermissions({ admin: false, push: false, pull: false })).toBeNull();
  });
});

describe("roleAtLeast", () => {
  it("orders viewer < maintenance < admin", () => {
    expect(roleAtLeast("admin", "maintenance")).toBe(true);
    expect(roleAtLeast("maintenance", "maintenance")).toBe(true);
    expect(roleAtLeast("viewer", "maintenance")).toBe(false);
    expect(roleAtLeast("maintenance", "admin")).toBe(false);
  });
});
