import { describe, expect, it } from "vitest";
import { CREDENTIAL_PATTERN } from "@shared/api/endpoints.ts";
import {
  attemptCredential,
  CREDENTIAL_STORAGE_KEY,
  forgetCredential,
  PENDING_STORAGE_KEY,
  pendingSubmission,
  rememberPending,
} from "./credential.ts";

function memoryStorage() {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
  };
}

describe("the attempt credential", () => {
  it("is at least 128 random bits in base64url and is stored before it is used", () => {
    const storage = memoryStorage();
    const credential = attemptCredential(storage);
    expect(credential).toMatch(CREDENTIAL_PATTERN);
    expect(credential.length).toBeGreaterThanOrEqual(22);
    expect(storage.data.get(CREDENTIAL_STORAGE_KEY)).toBe(credential);
  });

  it("is stable for the tab until the attempt ends, then renewed", () => {
    const storage = memoryStorage();
    const first = attemptCredential(storage);
    expect(attemptCredential(storage)).toBe(first);
    forgetCredential(storage);
    expect(attemptCredential(storage)).not.toBe(first);
  });

  it("still works when storage is unavailable or throws", () => {
    expect(attemptCredential(null)).toMatch(CREDENTIAL_PATTERN);
    const blocked = () => {
      throw new Error("blocked");
    };
    const broken = { getItem: blocked, setItem: blocked, removeItem: blocked };
    expect(attemptCredential(broken)).toMatch(CREDENTIAL_PATTERN);
    expect(() => forgetCredential(broken)).not.toThrow();
  });
});

describe("the pending submission marker", () => {
  it("remembers the address of a dispatched submission for the tab, and forgets it with the credential", () => {
    const storage = memoryStorage();
    expect(pendingSubmission(storage)).toBeNull();
    const credential = attemptCredential(storage);
    rememberPending("anna@example.hu", storage);
    expect(pendingSubmission(storage)).toEqual({ email: "anna@example.hu", credential });
    forgetCredential(storage);
    expect(pendingSubmission(storage)).toBeNull();
  });

  it("is not a pending submission without a credential, or when the marker is unreadable", () => {
    const storage = memoryStorage();
    storage.data.set(PENDING_STORAGE_KEY, JSON.stringify({ email: "anna@example.hu" }));
    expect(pendingSubmission(storage)).toBeNull();
    attemptCredential(storage);
    storage.data.set(PENDING_STORAGE_KEY, "{not json");
    expect(pendingSubmission(storage)).toBeNull();
    expect(pendingSubmission(null)).toBeNull();
  });
});
