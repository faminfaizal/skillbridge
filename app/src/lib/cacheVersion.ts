// One process-wide data version. Every in-memory cache (model, portfolio, discovery, signals) compares against it, so a
// single bump after the Connectivity Agent writes new data refreshes all of them, even if a bundler duplicated modules.
const G = globalThis as unknown as { __sbDataVersion?: number };

export function dataVersion(): number {
  return G.__sbDataVersion ?? 0;
}

export function bumpDataVersion(): number {
  G.__sbDataVersion = dataVersion() + 1;
  return G.__sbDataVersion;
}
