import { describe, expect, it } from "vitest";
import {
  OTP_REJECTION_LIMIT,
  constantTimeEqual,
  generateOtp,
  randomToken,
  sha256Hex,
} from "./crypto.ts";

describe("generateOtp", () => {
  it("is six digits, zero padded", () => {
    expect(generateOtp(() => 42)).toBe("000042");
    expect(generateOtp(() => 999_999)).toBe("999999");
    expect(generateOtp()).toMatch(/^\d{6}$/);
  });

  it("rejects values that would bias the modulo and draws again", () => {
    const draws = [OTP_REJECTION_LIMIT, 4_294_967_295, 123_456];
    let calls = 0;
    expect(generateOtp(() => draws[calls++] as number)).toBe("123456");
    expect(calls).toBe(3);
    // The largest accepted value is the one just below the limit
    expect(OTP_REJECTION_LIMIT % 1_000_000).toBe(0);
    expect(generateOtp(() => OTP_REJECTION_LIMIT - 1)).toBe("999999");
  });
});

describe("randomToken", () => {
  it("is 22 base64url characters for 16 bytes, and differs every time", () => {
    const first = randomToken(16);
    expect(first).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(randomToken(16)).not.toBe(first);
  });
});

describe("hashing and comparing", () => {
  it("hashes SHA-256 as lowercase hex", async () => {
    expect(await sha256Hex("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("compares in constant time and still tells equal from different", () => {
    expect(constantTimeEqual("abc", "abc")).toBe(true);
    expect(constantTimeEqual("abc", "abd")).toBe(false);
    expect(constantTimeEqual("abc", "abcd")).toBe(false);
  });
});
