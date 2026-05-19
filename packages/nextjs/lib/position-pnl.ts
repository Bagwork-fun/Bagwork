import { totalRedeemableCollateral } from "@/lib/ctf-redeem";

export type TradeSide = "buy" | "sell";

export type UserTradeEvent = {
  kind: TradeSide;
  conditionId: `0x${string}`;
  outcome: number;
  tokenAmount: bigint;
  usdcAmount: bigint;
  blockNumber: bigint;
  transactionHash: `0x${string}`;
  rail: "USDC" | "EURC";
};

export type OutcomeLedger = {
  totalCost: bigint;
  totalShares: bigint;
  realized: bigint;
};

export type PositionPnL = {
  costBasis: bigint;
  markValue: bigint;
  unrealized: bigint;
  realized: bigint;
  totalPnL: bigint;
};

/** Replay buys/sells with average-cost accounting for one outcome leg. */
export function buildOutcomeLedger(trades: UserTradeEvent[], conditionId: `0x${string}`, outcome: number): OutcomeLedger {
  const sorted = trades
    .filter(t => t.conditionId === conditionId && t.outcome === outcome)
    .sort((a, b) => (a.blockNumber === b.blockNumber ? 0 : a.blockNumber < b.blockNumber ? -1 : 1));

  let totalCost = 0n;
  let totalShares = 0n;
  let realized = 0n;

  for (const t of sorted) {
    if (t.kind === "buy") {
      totalCost += t.usdcAmount;
      totalShares += t.tokenAmount;
    } else {
      if (totalShares === 0n) {
        realized += t.usdcAmount;
        continue;
      }
      const costPortion = (totalCost * t.tokenAmount) / totalShares;
      realized += t.usdcAmount - costPortion;
      totalCost -= costPortion;
      totalShares -= t.tokenAmount;
    }
  }

  return { totalCost, totalShares, realized };
}

export function computePositionPnL(params: {
  shares: bigint;
  ledger: OutcomeLedger;
  markValue: bigint;
}): PositionPnL {
  const { shares, ledger, markValue } = params;
  const costBasis = shares > 0n ? ledger.totalCost : 0n;
  const unrealized = shares > 0n ? markValue - costBasis : 0n;
  const realized = ledger.realized;
  return {
    costBasis,
    markValue,
    unrealized,
    realized,
    totalPnL: unrealized + realized,
  };
}

export function redeemValueForBalances(
  yesBalance: bigint,
  noBalance: bigint,
  payoutNumerators: readonly bigint[],
  payoutDenominator: bigint,
): bigint {
  return totalRedeemableCollateral(yesBalance, noBalance, payoutNumerators, payoutDenominator);
}

export function formatPnLUsd(amount: bigint, decimals = 6): string {
  const n = Number(amount) / 10 ** decimals;
  const sign = n >= 0 ? "+" : "";
  return `${sign}${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function pnlColorClass(pnl: bigint): string {
  if (pnl > 0n) return "text-emerald-600 dark:text-emerald-400";
  if (pnl < 0n) return "text-red-600 dark:text-red-400";
  return "text-muted-foreground";
}
