import { CTF_PARENT_COLLECTION_ZERO } from "@/lib/market-tokens";

export { CTF_PARENT_COLLECTION_ZERO };

/** Binary markets: outcome 0 → index set 1, outcome 1 → index set 2. */
export function indexSetForOutcome(outcomeIndex: number): bigint {
  return 1n << BigInt(outcomeIndex);
}

export function estimateOutcomeRedeemPayout(
  balance: bigint,
  payoutNumerators: readonly bigint[],
  outcomeIndex: number,
  payoutDenominator: bigint,
): bigint {
  if (balance === 0n || payoutDenominator === 0n) return 0n;
  const indexSet = indexSetForOutcome(outcomeIndex);
  let numerator = 0n;
  for (let j = 0; j < payoutNumerators.length; j++) {
    if (indexSet & (1n << BigInt(j))) numerator += payoutNumerators[j] ?? 0n;
  }
  return (balance * numerator) / payoutDenominator;
}

export function buildRedeemIndexSets(yesBalance: bigint, noBalance: bigint): bigint[] {
  const sets: bigint[] = [];
  if (yesBalance > 0n) sets.push(1n);
  if (noBalance > 0n) sets.push(2n);
  return sets;
}

export function totalRedeemableCollateral(
  yesBalance: bigint,
  noBalance: bigint,
  payoutNumerators: readonly bigint[],
  payoutDenominator: bigint,
): bigint {
  return (
    estimateOutcomeRedeemPayout(yesBalance, payoutNumerators, 0, payoutDenominator) +
    estimateOutcomeRedeemPayout(noBalance, payoutNumerators, 1, payoutDenominator)
  );
}
