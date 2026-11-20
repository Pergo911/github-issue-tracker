declare global {
  interface Env {
    /**
     * Set only by `vite dev` (the local world, ticket #22): switches on the `/api/_dev/*` smoke routes.
     * Not in wrangler.jsonc, so a deployed Worker never has it.
     */
    LOCAL_WORLD?: string;
  }
}

export {};
