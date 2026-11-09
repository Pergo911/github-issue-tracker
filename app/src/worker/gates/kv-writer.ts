/**
 * The one place the gates write the Report mappings to KV, as an object so a test can fail or interleave a
 * write (a KV outage, a Reissue landing between two puts) without a fake KV. Production never replaces it.
 */
export const kvWriter = {
  put: (env: Env, key: string, value: string): Promise<void> => env.KV.put(key, value),
  delete: (env: Env, key: string): Promise<void> => env.KV.delete(key),
};
