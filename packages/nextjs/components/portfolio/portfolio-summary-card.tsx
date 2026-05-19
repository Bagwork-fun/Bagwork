"use client";

import Link from "next/link";
import { formatUnits } from "viem";
import { useAccount, useReadContract } from "wagmi";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { COLLATERAL_DECIMALS } from "@/lib/market-decimals";
import { formatPnLUsd, pnlColorClass } from "@/lib/position-pnl";
import type { PortfolioTotals } from "@/hooks/portfolio/usePortfolioPositions";
import { useDeployedContractInfo } from "~~/hooks/scaffold-eth";

export function PortfolioSummaryCard({
  totals,
  totalsLoading,
}: {
  totals?: PortfolioTotals;
  totalsLoading?: boolean;
}) {
  const { address, isConnecting } = useAccount();
  const { data: usdcInfo } = useDeployedContractInfo({ contractName: "MockUSDC" });
  const { data: eurcInfo } = useDeployedContractInfo({ contractName: "MockEURC" });

  const zero = "0x0000000000000000000000000000000000000000" as const;

  const { data: usdcBal, isPending: usdcPending } = useReadContract({
    address: usdcInfo?.address,
    abi: usdcInfo?.abi ?? [],
    functionName: "balanceOf",
    args: [address ?? zero],
    query: { enabled: !!address && !!usdcInfo },
  }) as { data: bigint | undefined; isPending: boolean };

  const { data: eurcBal, isPending: eurcPending } = useReadContract({
    address: eurcInfo?.address,
    abi: eurcInfo?.abi ?? [],
    functionName: "balanceOf",
    args: [address ?? zero],
    query: { enabled: !!address && !!eurcInfo },
  }) as { data: bigint | undefined; isPending: boolean };

  const fmt = (raw: bigint | undefined, pending: boolean) => {
    if (isConnecting || pending) return <Spinner className="size-6" />;
    const n =
      raw !== undefined
        ? Number(formatUnits(raw, COLLATERAL_DECIMALS)).toLocaleString(undefined, {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          })
        : "0.00";
    return n;
  };

  const fmtTotal = (v: bigint | undefined) => {
    if (totalsLoading || !address) return <Spinner className="size-5" />;
    return formatPnLUsd(v ?? 0n);
  };

  return (
    <div className="rounded-2xl border overflow-hidden ring-1 ring-border/60 bg-card">
      <div className="p-6 gap-6 flex flex-col">
        <div>
          <div className="text-sm text-muted-foreground">Collateral balances</div>
          <div className="text-2xl font-semibold mt-2 space-y-1">
            <div>USDC · {fmt(usdcBal, usdcPending)}</div>
            <div>EURC · {fmt(eurcBal, eurcPending)}</div>
          </div>
        </div>

        {address ? (
          <div className="border-t pt-4 space-y-3">
            <div className="text-sm text-muted-foreground">Position PnL</div>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Position value</span>
                <span className="tabular-nums font-medium">
                  {totalsLoading ? (
                    <Spinner className="size-4" />
                  ) : (
                    `$${Number(formatUnits(totals?.positionValue ?? 0n, COLLATERAL_DECIMALS)).toFixed(2)}`
                  )}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Unrealized</span>
                <span className={`tabular-nums font-medium ${pnlColorClass(totals?.unrealizedPnL ?? 0n)}`}>
                  {fmtTotal(totals?.unrealizedPnL)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Realized</span>
                <span className={`tabular-nums font-medium ${pnlColorClass(totals?.realizedPnL ?? 0n)}`}>
                  {fmtTotal(totals?.realizedPnL)}
                </span>
              </div>
              <div className="flex justify-between border-t pt-2">
                <span className="font-medium">Total PnL</span>
                <span className={`tabular-nums font-semibold ${pnlColorClass(totals?.totalPnL ?? 0n)}`}>
                  {fmtTotal(totals?.totalPnL)}
                </span>
              </div>
            </div>
          </div>
        ) : null}

        <div className="text-xs text-muted-foreground">
          Need USDC on-chain?{" "}
          <Link href="/deposit" className="underline font-medium text-foreground">
            Bridge via CCTP
          </Link>
          .
        </div>

        {!address ? (
          <Button className="w-full h-11" asChild>
            <Link href="/">Explore markets</Link>
          </Button>
        ) : (
          <Button variant="outline" className="w-full h-11" asChild>
            <Link href="/">Browse markets</Link>
          </Button>
        )}
      </div>
    </div>
  );
}
