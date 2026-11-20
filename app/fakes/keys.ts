/**
 * Throwaway RSA key pairs for the fake GitHub App (WebCrypto only: the same code runs in Node and workerd).
 * Nothing is committed: every local world and every Worker test file generates its own, so no private key
 * ever sits in the repository. The Bot client signs with the private half; the fake GitHub verifies with the
 * public half, exactly as GitHub does.
 */

const encoder = new TextEncoder();

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function toPem(label: string, der: Uint8Array): string {
  const lines = toBase64(der).match(/.{1,64}/g) ?? [];
  return `-----BEGIN ${label}-----\n${lines.join("\n")}\n-----END ${label}-----\n`;
}

export function fromPem(pem: string): Uint8Array<ArrayBuffer> {
  const body = pem.replace(/-----(BEGIN|END)[A-Z ]+-----/g, "").replace(/\s+/g, "");
  return Uint8Array.from(atob(body), (character) => character.charCodeAt(0));
}

/** Reads one DER element: its tag, where its content starts and ends. */
function readElement(bytes: Uint8Array, offset: number) {
  const tag = bytes[offset];
  let length = bytes[offset + 1];
  let start = offset + 2;
  if (tag === undefined || length === undefined) throw new Error("truncated DER");
  if (length & 0x80) {
    const count = length & 0x7f;
    length = 0;
    for (let index = 0; index < count; index++) length = length * 256 + (bytes[start + index] ?? 0);
    start += count;
  }
  return { tag, start, end: start + length };
}

/** The RSA key inside a PKCS#8 wrapper, i.e. the PKCS#1 form GitHub's downloaded `.pem` uses. */
function pkcs8ToPkcs1(pkcs8: Uint8Array): Uint8Array {
  const outer = readElement(pkcs8, 0);
  const version = readElement(pkcs8, outer.start);
  const algorithm = readElement(pkcs8, version.end);
  const octets = readElement(pkcs8, algorithm.end);
  if (octets.tag !== 0x04) throw new Error("not a PKCS#8 RSA key");
  return pkcs8.slice(octets.start, octets.end);
}

export interface AppKeyPair {
  /** `-----BEGIN PRIVATE KEY-----`: what WebCrypto imports. */
  privateKeyPkcs8: string;
  /** `-----BEGIN RSA PRIVATE KEY-----`: the form GitHub hands out when you generate an App key. */
  privateKeyPkcs1: string;
  /** `-----BEGIN PUBLIC KEY-----`: what the fake GitHub verifies App JWTs with. */
  publicKey: string;
}

export async function generateAppKeyPair(): Promise<AppKeyPair> {
  const pair = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  );
  const pkcs8 = new Uint8Array(await crypto.subtle.exportKey("pkcs8", pair.privateKey));
  const spki = new Uint8Array(await crypto.subtle.exportKey("spki", pair.publicKey));
  return {
    privateKeyPkcs8: toPem("PRIVATE KEY", pkcs8),
    privateKeyPkcs1: toPem("RSA PRIVATE KEY", pkcs8ToPkcs1(pkcs8)),
    publicKey: toPem("PUBLIC KEY", spki),
  };
}

export async function importPublicKey(pem: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "spki",
    fromPem(pem),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"],
  );
}

/**
 * Derives the public half from a private key, so a developer who supplies `BOT_APP_PRIVATE_KEY` themselves
 * (PKCS#8 only: this helper does not wrap PKCS#1) still gets a matching fake. Used by the dev server.
 */
export async function publicKeyFromPrivatePkcs8(pem: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "pkcs8",
    fromPem(pem),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    true,
    ["sign"],
  );
  const jwk = await crypto.subtle.exportKey("jwk", key);
  const publicJwk = { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: "RS256", ext: true };
  const publicKey = await crypto.subtle.importKey(
    "jwk",
    publicJwk,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    true,
    ["verify"],
  );
  return toPem("PUBLIC KEY", new Uint8Array(await crypto.subtle.exportKey("spki", publicKey)));
}

export function base64Url(data: Uint8Array | string): string {
  const bytes = typeof data === "string" ? encoder.encode(data) : data;
  return toBase64(bytes).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

export function fromBase64Url(text: string): Uint8Array<ArrayBuffer> {
  const padded = text
    .replaceAll("-", "+")
    .replaceAll("_", "/")
    .padEnd(Math.ceil(text.length / 4) * 4, "=");
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
}
