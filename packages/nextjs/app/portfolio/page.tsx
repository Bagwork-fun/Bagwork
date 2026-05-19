"use client";

import { PortfolioPositionsPnL } from "@/components/portfolio/portfolio-positions-pnl";
import { PortfolioSummaryCard } from "@/components/portfolio/portfolio-summary-card";
import { usePortfolioPositions } from "@/hooks/portfolio/usePortfolioPositions";

export default function PortfolioPage() {
  const { openRows, resolvedRows, trades, totals, isLoading } = usePortfolioPositions();

  return (
    <div className="mx-auto max-w-[90rem] px-6 py-6">
      <div className="flex flex-col xl:flex-row gap-6">
        <div className="w-full xl:w-80 shrink-0">
          <PortfolioSummaryCard totals={totals} totalsLoading={isLoading} />
        </div>
        <div className="flex-1 min-w-0">
          <PortfolioPositionsPnL
            openRows={openRows}
            resolvedRows={resolvedRows}
            trades={trades}
            isLoading={isLoading}
          />
        </div>
      </div>
    </div>
  );
}
