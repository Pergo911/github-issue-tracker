/**
 * The Bot's App JWT (SPEC 3.3): RS256, `iat` 60 s in the past (clock skew), `exp` 9 minutes ahead (GitHub's
 * maximum is 10), `iss` the App id. WebCrypto only.
 *
 * KEY FORMAT. GitHub hands out the private key as PKCS#1 (`-----BEGIN RSA PRIVATE KEY-----`); WebCrypto only
 * imports PKCS#8 (`-----BEGIN PRIVATE KEY-----`). This module accepts BOTH: a PKCS#1 key is wrapped into a
 * PKCS#8 envelope in code, so the secret can be the downloaded `.pem` unchanged
 * (`wrangler secret put BOT_APP_PRIVATE_KEY < app.pem`). Secret stores often turn the key's newlines into the
 * two characters backslash and n, so those are restored first.
 */

const encoder = new TextEncoder();

function base64Url(data: Uint8Array | string): string {
  const bytes = typeof data === "string" ? encoder.encode(data) : data;
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function derLength(length: number): number[] {
  if (length < 0x80) return [length];
  const bytes: number[] = [];
  for (let rest = length; rest > 0; rest >>= 8) bytes.unshift(rest & 0xff);
  return [0x80 | bytes.length, ...bytes];
}

function der(tag: number, body: ArrayLike<number>): Uint8Array<ArrayBuffer> {
  return Uint8Array.from([tag, ...derLength(body.length), ...Array.from(body)]);
}

/** Wraps a PKCS#1 RSAPrivateKey in the PKCS#8 PrivateKeyInfo envelope: version 0, rsaEncryption, the key. */
function pkcs1ToPkcs8(pkcs1: Uint8Array): Uint8Array<ArrayBuffer> {
  const algorithm = [
    0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00,
  ];
  return der(0x30, [0x02, 0x01, 0x00, ...algorithm, ...der(0x04, pkcs1)]);
}

function unpem(pem: string): Uint8Array<ArrayBuffer> {
  const body = pem.replace(/-----(BEGIN|END)[A-Z ]+-----/g, "").replace(/\s+/g, "");
  return Uint8Array.from(atob(body), (character) => character.charCodeAt(0));
}

/** Imports the App key from PKCS#1 or PKCS#8 PEM text. Never puts the text in an error message. */
export async function importAppKey(pem: string): Promise<CryptoKey> {
  const text = pem.replaceAll(String.raw`\n`, "\n").trim();
  if (!/^-----BEGIN (RSA )?PRIVATE KEY-----/.test(text)) {
    throw new Error(
      "BOT_APP_PRIVATE_KEY is not a PEM private key (expected BEGIN RSA PRIVATE KEY or BEGIN PRIVATE KEY)",
    );
  }
  let bytes: Uint8Array<ArrayBuffer>;
  try {
    bytes = unpem(text);
  } catch {
    throw new Error("BOT_APP_PRIVATE_KEY is not valid base64 PEM");
  }
  const pkcs8 = text.startsWith("-----BEGIN RSA PRIVATE KEY-----") ? pkcs1ToPkcs8(bytes) : bytes;
  try {
    return await crypto.subtle.importKey(
      "pkcs8",
      pkcs8,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["sign"],
    );
  } catch {
    throw new Error("BOT_APP_PRIVATE_KEY could not be imported as an RSA private key");
  }
}

export async function signAppJwt(
  privateKeyPem: string,
  appId: string,
  now = Math.floor(Date.now() / 1000),
): Promise<string> {
  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = base64Url(JSON.stringify({ iat: now - 60, exp: now + 540, iss: appId }));
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    await importAppKey(privateKeyPem),
    encoder.encode(`${header}.${claims}`),
  );
  return `${header}.${claims}.${base64Url(new Uint8Array(signature))}`;
}
