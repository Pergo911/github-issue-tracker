import { describe, expect, it } from "vitest";
import { createTokenStore, type StorageLike } from "./token-store.ts";

function memoryStorage(): StorageLike & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
    removeItem: (key) => void data.delete(key),
  };
}

const tokens = {
  accessToken: "ghu_a",
  refreshToken: "ghr_a",
  expiresIn: 28_800,
  refreshTokenExpiresIn: 100_000,
};

describe("the Staff token store", () => {
  it("keeps the pair across a reload (a new store over the same storage)", () => {
    const storage = memoryStorage();
    createTokenStore(storage, () => 1_000).save(tokens);
    const reloaded = createTokenStore(storage, () => 2_000);
    expect(reloaded.read()).toMatchObject({ accessToken: "ghu_a", refreshToken: "ghr_a" });
  });

  it("knows when the access token is due: expired or within a minute of it", () => {
    let now = 0;
    const store = createTokenStore(memoryStorage(), () => now);
    store.save(tokens);
    expect(store.accessTokenDue()).toBe(false);
    now = 28_800_000 - 59_000;
    expect(store.accessTokenDue()).toBe(true);
  });

  it("clears everything on sign-out and tells subscribers", () => {
    const storage = memoryStorage();
    const store = createTokenStore(storage, () => 0);
    let calls = 0;
    store.subscribe(() => (calls += 1));
    store.save(tokens);
    store.clear();
    expect(store.read()).toBeNull();
    expect(storage.data.size).toBe(0);
    expect(calls).toBe(2);
  });

  it("treats damaged storage as signed out, and survives storage that throws", () => {
    const storage = memoryStorage();
    storage.setItem("staff.tokens", "{not json");
    expect(createTokenStore(storage, () => 0).read()).toBeNull();
    const broken: StorageLike = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    };
    const store = createTokenStore(broken, () => 0);
    expect(store.read()).toBeNull();
    store.save(tokens);
    // Held in memory for this page load even when the browser refuses to persist it.
    expect(store.read()?.accessToken).toBe("ghu_a");
  });

  it("returns a stable snapshot until something changes (for useSyncExternalStore)", () => {
    const store = createTokenStore(memoryStorage(), () => 0);
    store.save(tokens);
    expect(store.read()).toBe(store.read());
  });
});
