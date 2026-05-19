"use client";

import Link from "next/link";
import { formatUnits } from "viem";

import { Spinner } from "@/components/ui/spinner";
import { COLLATERAL_DECIMALS, OUTCOME_SHARE_DECIMALS } from "@/lib/market-decimals";
import { buildOutcomeLedger, computePositionPnL, formatPnLUsd, pnlColorClass } from "@/lib/position-pnl";
import { useUserTradeHistory } from "@/hooks/portfolio/useUserTradeHistory";

export function YourPositionCard({
  conditionId,
  yesBalance,
  noBalance,
  yesMark,
  noMark,
  resolved,
}: {
  conditionId: `0x${string}`;
  yesBalance: bigint;
  noBalance: bigint;
  yesMark: bigint;
  noMark: bigint;
  resolved: boolean;
}) {
  const { trades, isLoading } = useUserTradeHistory(conditionId);

  if (yesBalance === 0n && noBalance === 0n) {
    return null;
  }

  const yesLedger = buildOutcomeLedger(trades, conditionId, 0);
  const noLedger = buildOutcomeLedger(trades, conditionId, 1);
  const yesPnl = yesBalance > 0n ? computePositionPnL({ shares: yesBalance, ledger: yesLedger, markValue: yesMark }) : null;
  const noPnl = noBalance > 0n ? computePositionPnL({ shares: noBalance, ledger: noLedger, markValue: noMark }) : null;

  const totalUnrealized = (yesPnl?.unrealized ?? 0n) + (noPnl?.unrealized ?? 0n);
  const totalRealized = (yesPnl?.realized ?? 0n) + (noPnl?.realized ?? 0n);
  const totalPnL = totalUnrealized + totalRealized;

  return (
    <div className="rounded-xl border bg-card p-4 space-y-3 text-sm">
      <div className="flex justify-between items-center">
        <h3 className="font-semibold">Your position</h3>
        <Link href="/portfolio" className="text-xs text-primary underline">
          Portfolio
        </Link>
      </div>
      {isLoading ? (
        <Spinner className="size-5" />
      ) : (
        <>
          {yesBalance > 0n && (
            <div className="flex justify-between text-muted-foreground">
              <span>YES · {formatUnits(yesBalance, OUTCOME_SHARE_DECIMALS)} shares</span>
              <span className={pnlColorClass(yesPnl?.totalPnL ?? 0n)}>{formatPnLUsd(yesPnl?.totalPnL ?? 0n)}</span>
            </div>
          )}
          {noBalance > 0n && (
            <div className="flex justify-between text-muted-foreground">
              <span>NO · {formatUnits(noBalance, OUTCOME_SHARE_DECIMALS)} shares</span>
              <span className={pnlColorClass(noPnl?.totalPnL ?? 0n)}>{formatPnLUsd(noPnl?.totalPnL ?? 0n)}</span>
            </div>
          )}
          <div className="flex justify-between border-t pt-2 font-medium">
            <span>{resolved ? "Est. PnL (resolved)" : "Unrealized PnL"}</span>
            <span className={pnlColorClass(totalPnL)}>{formatPnLUsd(totalPnL)}</span>
          </div>
          <p className="text-[10px] text-muted-foreground">
            Cost basis from indexed trades · {formatUnits((yesPnl?.costBasis ?? 0n) + (noPnl?.costBasis ?? 0n), COLLATERAL_DECIMALS)}{" "}
            USDC/EURC spent (net)
          </p>
        </>
      )}
    </div>
  );
}
