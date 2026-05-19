import { formatUnits } from "viem";

import { COLLATERAL_DECIMALS } from "@/lib/market-decimals";

export type LpPnLSummaryOnChain = {
  totalDeposited: bigint;
  totalWithdrawn: bigint;
  tradingRevenue: bigint;
  poolInventory: bigint;
  walletInventory: bigint;
  nav: bigint;
  netPnl: bigint;
};

export type LpLiquidityEvent = {
  kind: "deposit" | "withdraw";
  usdcAmount: bigint;
};

/** Sum PoolCreated + LiquidityAdded − LiquidityRemoved when on-chain counters are zero (legacy pools). */
export function depositsFromEvents(events: LpLiquidityEvent[]): bigint {
  let deposited = 0n;
  let withdrawn = 0n;
  for (const e of events) {
    if (e.kind === "deposit") deposited += e.usdcAmount;
    else withdrawn += e.usdcAmount;
  }
  return deposited > withdrawn ? deposited - withdrawn : 0n;
}

export function effectiveLpDeposited(summary: LpPnLSummaryOnChain, eventNetDeposited: bigint): bigint {
  return summary.totalDeposited > 0n ? summary.totalDeposited : eventNetDeposited;
}

export function formatCollateral(amount: bigint, decimals = COLLATERAL_DECIMALS): string {
  return Number(formatUnits(amount, decimals)).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function formatSignedPnl(pnl: bigint, decimals = COLLATERAL_DECIMALS): string {
  const n = Number(formatUnits(pnl, decimals));
  const sign = n >= 0 ? "+" : "";
  return `${sign}${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function pnlTone(pnl: bigint): "profit" | "loss" | "flat" {
  if (pnl > 0n) return "profit";
  if (pnl < 0n) return "loss";
  return "flat";
}
