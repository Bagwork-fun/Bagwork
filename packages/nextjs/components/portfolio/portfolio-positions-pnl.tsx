"use client";

import Link from "next/link";
import { formatUnits } from "viem";

import { PortfolioMarketTitle } from "@/components/portfolio/portfolio-market-title";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Spinner } from "@/components/ui/spinner";
import { COLLATERAL_DECIMALS, OUTCOME_SHARE_DECIMALS } from "@/lib/market-decimals";
import { formatPnLUsd, pnlColorClass, type UserTradeEvent } from "@/lib/position-pnl";
import type { PortfolioPositionRow } from "@/hooks/portfolio/usePortfolioPositions";

function fmtUsd(v: bigint) {
  return Number(formatUnits(v, COLLATERAL_DECIMALS)).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function fmtShares(v: bigint) {
  return Number(formatUnits(v, OUTCOME_SHARE_DECIMALS)).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  });
}

function EmptyState({ message }: { message: string }) {
  return <div className="py-12 text-center text-muted-foreground text-sm">{message}</div>;
}

function PositionTable({ rows, showRedeem }: { rows: PortfolioPositionRow[]; showRedeem?: boolean }) {
  if (rows.length === 0) {
    return <EmptyState message="No positions in this category." />;
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Market</TableHead>
          <TableHead>Rail</TableHead>
          <TableHead>Outcome</TableHead>
          <TableHead className="text-right">Shares</TableHead>
          <TableHead className="text-right">Cost</TableHead>
          <TableHead className="text-right">Value</TableHead>
          <TableHead className="text-right">Unrealized</TableHead>
          <TableHead className="text-right">Realized</TableHead>
          <TableHead className="text-right">Total PnL</TableHead>
          {showRedeem ? <TableHead className="text-right">Action</TableHead> : null}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map(r => (
          <TableRow key={`${r.questionId}-${r.side}-${r.rail}`} className="h-14">
            <TableCell>
              <Link href={`/markets/${r.questionId}`} className="hover:underline">
                <PortfolioMarketTitle questionId={r.questionId} />
              </Link>
            </TableCell>
            <TableCell className="text-xs font-medium">{r.rail}</TableCell>
            <TableCell>
              <span
                className={
                  r.side === "Yes"
                    ? "text-teal-600 dark:text-teal-400 font-medium text-sm"
                    : "text-red-600/80 dark:text-red-400 font-medium text-sm"
                }
              >
                {r.side}
              </span>
            </TableCell>
            <TableCell className="text-right text-sm tabular-nums">{fmtShares(r.shares)}</TableCell>
            <TableCell className="text-right text-sm tabular-nums">{fmtUsd(r.costBasis)}</TableCell>
            <TableCell className="text-right text-sm tabular-nums">
              {fmtUsd(r.status === "resolved" && r.redeemable > 0n ? r.redeemable : r.markValue)}
            </TableCell>
            <TableCell className={`text-right text-sm tabular-nums ${pnlColorClass(r.unrealizedPnL)}`}>
              {formatPnLUsd(r.unrealizedPnL)}
            </TableCell>
            <TableCell className={`text-right text-sm tabular-nums ${pnlColorClass(r.realizedPnL)}`}>
              {formatPnLUsd(r.realizedPnL)}
            </TableCell>
            <TableCell className={`text-right text-sm tabular-nums font-medium ${pnlColorClass(r.totalPnL)}`}>
              {formatPnLUsd(r.totalPnL)}
            </TableCell>
            {showRedeem ? (
              <TableCell className="text-right">
                {r.redeemable > 0n ? (
                  <Link href={`/markets/${r.questionId}`} className="text-xs font-medium text-primary underline">
                    Redeem
                  </Link>
                ) : (
                  <span className="text-xs text-muted-foreground">Redeemed</span>
                )}
              </TableCell>
            ) : null}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function TradeHistoryTable({ trades }: { trades: UserTradeEvent[] }) {
  if (trades.length === 0) {
    return <EmptyState message="No trades indexed for this wallet yet." />;
  }

  const sorted = [...trades].reverse();

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Type</TableHead>
          <TableHead>Condition</TableHead>
          <TableHead>Rail</TableHead>
          <TableHead>Side</TableHead>
          <TableHead className="text-right">Shares</TableHead>
          <TableHead className="text-right">USDC</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {sorted.map((t, idx) => (
          <TableRow key={`${t.transactionHash}-${idx}`}>
            <TableCell className="text-sm capitalize">{t.kind}</TableCell>
            <TableCell className="font-mono text-xs">
              {t.conditionId.slice(0, 8)}…{t.conditionId.slice(-4)}
            </TableCell>
            <TableCell className="text-xs">{t.rail}</TableCell>
            <TableCell className="text-sm">{t.outcome === 0 ? "Yes" : "No"}</TableCell>
            <TableCell className="text-right tabular-nums text-sm">{fmtShares(t.tokenAmount)}</TableCell>
            <TableCell className="text-right tabular-nums text-sm">{fmtUsd(t.usdcAmount)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export type PortfolioPositionsPnLProps = {
  openRows: PortfolioPositionRow[];
  resolvedRows: PortfolioPositionRow[];
  trades: UserTradeEvent[];
  isLoading: boolean;
};

export function PortfolioPositionsPnL({ openRows, resolvedRows, trades, isLoading }: PortfolioPositionsPnLProps) {
  if (isLoading) {
    return (
      <div className="flex justify-center py-16">
        <Spinner className="size-8" />
      </div>
    );
  }

  return (
    <Tabs defaultValue="open">
      <TabsList variant="line">
        <TabsTrigger value="open">Open ({openRows.length})</TabsTrigger>
        <TabsTrigger value="resolved">Resolved ({resolvedRows.length})</TabsTrigger>
        <TabsTrigger value="history">Trade history ({trades.length})</TabsTrigger>
      </TabsList>
      <TabsContent value="open" className="pt-2">
        <PositionTable rows={openRows} />
      </TabsContent>
      <TabsContent value="resolved" className="pt-2">
        <PositionTable rows={resolvedRows} showRedeem />
      </TabsContent>
      <TabsContent value="history" className="pt-2">
        <TradeHistoryTable trades={trades} />
      </TabsContent>
    </Tabs>
  );
}
