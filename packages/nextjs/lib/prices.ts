/** Yes / No probabilities as decimals in [0, 1]. */
export function parseYesNoFromProbability(yesProbabilityMicros: bigint, scale = 1_000_000n): [number, number] {
  const yes = Number(yesProbabilityMicros) / Number(scale);
  const clampedYes = Number.isFinite(yes) ? Math.min(1, Math.max(0, yes)) : 0;
  return [clampedYes, 1 - clampedYes];
}

export function formatOdds(price: number): string {
  const pct = Math.round(price * 100);
  if (pct < 1 && price > 0) return "<1%";
  return `${pct}%`;
}

export function formatVolume(vol: number): string {
  if (vol >= 1_000_000_000) return `$${(vol / 1_000_000_000).toFixed(1)}B`;
  if (vol >= 1_000_000) return `$${(vol / 1_000_000).toFixed(0)}M`;
  if (vol >= 1_000) return `$${(vol / 1_000).toFixed(0)}K`;
  return `$${vol.toFixed(0)}`;
}
