import { base64Url, fromPem } from "../keys.ts";

/**
 * An App JWT signer written independently of the Worker's Bot client, so the fake's tests do not agree with
 * the code under test by construction. Claims default to the shape GitHub documents: `iat` 60 s in the past,
 * `exp` 9 minutes ahead (10 is the maximum), `iss` the App id.
 */
export async function signTestJwt(
  privateKeyPkcs8: string,
  claims: Partial<{ iat: number; exp: number; iss: string }> & { iss: string },
  now = Math.floor(Date.now() / 1000),
  header: Record<string, unknown> = { alg: "RS256", typ: "JWT" },
): Promise<string> {
  const payload = { iat: now - 60, exp: now + 540, ...claims };
  const signingInput = `${base64Url(JSON.stringify(header))}.${base64Url(JSON.stringify(payload))}`;
  const key = await crypto.subtle.importKey(
    "pkcs8",
    fromPem(privateKeyPkcs8),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(signingInput),
  );
  return `${signingInput}.${base64Url(new Uint8Array(signature))}`;
}
