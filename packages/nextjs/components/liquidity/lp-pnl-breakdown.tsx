"use client";

import { type Address } from "viem";

import { Spinner } from "@/components/ui/spinner";
import { formatCollateral, formatSignedPnl, pnlTone } from "@/lib/lp-pnl";
import type { SettlementRail } from "@/lib/marketRails";
import { useLpPoolPnL } from "@/hooks/liquidity/useLpPoolPnL";

export function LpPnLBreakdown({
  conditionId,
  rail,
  lpOwner,
  compact,
}: {
  conditionId: `0x${string}`;
  rail: SettlementRail;
  lpOwner?: Address;
  compact?: boolean;
}) {
  const { summary, effectiveDeposited, netPnl, isLoading } = useLpPoolPnL(conditionId, rail, lpOwner);

  if (isLoading) {
    return (
      <div className="flex justify-center py-4">
        <Spinner className="size-5" />
      </div>
    );
  }

  if (!summary) {
    return <p className="text-xs text-muted-foreground">PnL data unavailable.</p>;
  }

  const tone = pnlTone(netPnl);
  const pnlClass =
    tone === "profit"
      ? "text-emerald-600 dark:text-emerald-400"
      : tone === "loss"
        ? "text-red-600 dark:text-red-400"
        : "text-muted-foreground";

  const rows: [string, string][] = [
    ["Net trading revenue", `${formatCollateral(summary.tradingRevenue)} ${rail}`],
    ["Pool inventory", `${formatCollateral(summary.poolInventory)} ${rail}`],
    ["Wallet inventory", `${formatCollateral(summary.walletInventory)} ${rail}`],
    ["Total NAV", `${formatCollateral(summary.nav)} ${rail}`],
    ["Total deposited", `${formatCollateral(effectiveDeposited)} ${rail}`],
    ["Total withdrawn", `${formatCollateral(summary.totalWithdrawn)} ${rail}`],
  ];

  if (compact) {
    return (
      <div className="text-xs space-y-0.5">
        <div className={pnlClass}>
          Net PnL: {formatSignedPnl(netPnl)} {rail}
        </div>
        <div className="text-muted-foreground">
          NAV {formatCollateral(summary.nav)} · Rev {formatCollateral(summary.tradingRevenue)}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2 text-sm">
      {rows.map(([k, v]) => (
        <div key={k} className="flex justify-between gap-2">
          <span className="text-muted-foreground">{k}</span>
          <span className="font-medium tabular-nums text-right">{v}</span>
        </div>
      ))}
      <div className="flex justify-between border-t pt-2 font-semibold">
        <span>Net LP PnL</span>
        <span className={`tabular-nums ${pnlClass}`}>
          {formatSignedPnl(netPnl)} {rail}
        </span>
      </div>
      <p className="text-[10px] text-muted-foreground leading-snug">
        After resolution, withdraw pulls trading revenue and redeems AMM pool reserves. Redeem any wallet-held CTF
        tokens on the market page.
      </p>
    </div>
  );
}
