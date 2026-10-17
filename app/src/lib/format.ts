export const money = (n: number) =>
  Math.abs(n) >= 1_000_000 ? `$${(n / 1_000_000).toFixed(2)}M` : Math.abs(n) >= 10_000 ? `$${Math.round(n / 1000)}k` : `$${Math.round(n).toLocaleString("en-US")}`;
export const pct = (x: number) => `${Math.round(x * 100)}%`;
