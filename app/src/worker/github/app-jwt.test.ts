import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { generateAppKeyPair, importPublicKey, fromBase64Url } from "@fakes/keys.ts";
import { signAppJwt } from "./app-jwt.ts";

async function verify(jwt: string, publicKeyPem: string): Promise<boolean> {
  const [head, claims, signature] = jwt.split(".") as [string, string, string];
  return crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    await importPublicKey(publicKeyPem),
    fromBase64Url(signature),
    new TextEncoder().encode(`${head}.${claims}`),
  );
}

function decode(part: string): Record<string, unknown> {
  return JSON.parse(new TextDecoder().decode(fromBase64Url(part))) as Record<string, unknown>;
}

describe("signAppJwt", () => {
  it("signs RS256 with the claims GitHub documents: iat 60 s back, exp within 10 minutes, iss the App id", async () => {
    const keys = await generateAppKeyPair();
    const now = 1_800_000_000;
    const jwt = await signAppJwt(keys.privateKeyPkcs8, "424242", now);
    const [head, claims] = jwt.split(".") as [string, string];
    expect(decode(head)).toEqual({ alg: "RS256", typ: "JWT" });
    expect(decode(claims)).toEqual({ iat: now - 60, exp: now + 540, iss: "424242" });
    expect(await verify(jwt, keys.publicKey)).toBe(true);
  });

  it("accepts the PKCS#1 key GitHub hands out, converting it to the PKCS#8 WebCrypto imports", async () => {
    const keys = await generateAppKeyPair();
    expect(keys.privateKeyPkcs1).toContain("BEGIN RSA PRIVATE KEY");
    const jwt = await signAppJwt(keys.privateKeyPkcs1, "1");
    expect(await verify(jwt, keys.publicKey)).toBe(true);
  });

  it("accepts a PKCS#8 key as well", async () => {
    const keys = await generateAppKeyPair();
    expect(keys.privateKeyPkcs8).toContain("BEGIN PRIVATE KEY");
    expect(await verify(await signAppJwt(keys.privateKeyPkcs8, "1"), keys.publicKey)).toBe(true);
  });

  it("accepts CRLF line endings, and a key whose newlines arrived as the two characters backslash and n", async () => {
    const keys = await generateAppKeyPair();
    const crlf = keys.privateKeyPkcs1.replaceAll("\n", "\r\n");
    expect(await verify(await signAppJwt(crlf, "1"), keys.publicKey)).toBe(true);
    const escaped = keys.privateKeyPkcs1.trim().replaceAll("\n", String.raw`\n`);
    expect(escaped).not.toContain("\n");
    expect(await verify(await signAppJwt(escaped, "1"), keys.publicKey)).toBe(true);
  });

  it("signs with the Worker's own secret, in the form the tests configure (PKCS#1)", async () => {
    expect(env.BOT_APP_PRIVATE_KEY).toContain("BEGIN RSA PRIVATE KEY");
    const jwt = await signAppJwt(env.BOT_APP_PRIVATE_KEY, env.BOT_APP_ID);
    expect(await verify(jwt, env.TEST_BOT_PUBLIC_KEY)).toBe(true);
  });

  it("fails clearly on text that is not a key, without echoing it", async () => {
    await expect(signAppJwt("local-development-placeholder", "1")).rejects.toThrow(
      /BOT_APP_PRIVATE_KEY is not a PEM private key/,
    );
    await expect(signAppJwt("local-development-placeholder", "1")).rejects.not.toThrow(
      /local-development-placeholder/,
    );
  });
});
