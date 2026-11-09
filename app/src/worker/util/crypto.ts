/** Small CSPRNG and hashing helpers shared by the gates and the report routes. */

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** `byteCount` CSPRNG bytes, base64url without padding: 16 bytes is the 22-character Status token. */
export function randomToken(byteCount: number): string {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(byteCount)));
}

const UINT32_RANGE = 2 ** 32;
const OTP_RANGE = 1_000_000;
/** Values at or above this are rejected, so `value % 10^6` has no modulo bias. */
export const OTP_REJECTION_LIMIT = UINT32_RANGE - (UINT32_RANGE % OTP_RANGE);

export function randomUint32(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0] as number;
}

/** A 6-digit code from a CSPRNG, rejection-sampled (SPEC 4.5). The source is injectable for the test. */
export function generateOtp(source: () => number = randomUint32): string {
  for (;;) {
    const value = source();
    if (value < OTP_REJECTION_LIMIT) return String(value % OTP_RANGE).padStart(6, "0");
  }
}

/** Compares two equal-purpose strings without stopping at the first difference. */
export function constantTimeEqual(a: string, b: string): boolean {
  const left = new TextEncoder().encode(a);
  const right = new TextEncoder().encode(b);
  let difference = left.length ^ right.length;
  for (let index = 0; index < Math.max(left.length, right.length); index++) {
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }
  return difference === 0;
}
