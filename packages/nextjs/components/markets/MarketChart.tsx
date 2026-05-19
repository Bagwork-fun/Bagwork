"use client";

import { useEffect, useMemo, useState } from "react";

import { PremiumChanceLineChart, type DualSeriesPoint } from "~~/components/markets/charts/PremiumChanceLineChart";

/** Local calendar noon for the same wall-clock day as `ms` — rolling window ends today in the user's TZ. */
function localNoonForInstant(ms: number): number {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12, 0, 0, 0).getTime();
}

function generateMockData(yesProb: number, seriesEndMs: number): DualSeriesPoint[] {
  const data: DualSeriesPoint[] = [];
  const dayMs = 24 * 60 * 60 * 1000;

  for (let i = 14; i >= 0; i--) {
    const t = seriesEndMs - i * dayMs;
    const progress = (14 - i) / 14;
    const target = 50 + (yesProb - 50) * progress;
    const wobble = Math.sin(i * 1.71 + yesProb * 0.02) * 5 * (1 - progress);
    let currentP = Math.max(0, Math.min(100, target + wobble));
    data.push({
      t,
      Yes: Math.round(currentP * 10) / 10,
      No: Math.round((100 - currentP) * 10) / 10,
    });
  }

  data[data.length - 1].Yes = yesProb;
  data[data.length - 1].No = 100 - yesProb;
  return data;
}

/** Mock history ending at implied current AMM probabilities (Starter-style chart proportions). */
export function MarketChart({ yesProb }: { yesProb: number; noProb: number }) {
  const [seriesEndMs, setSeriesEndMs] = useState<number | null>(null);

  useEffect(() => {
    setSeriesEndMs(localNoonForInstant(Date.now()));
  }, []);

  const chartData = useMemo(() => {
    if (seriesEndMs == null) return null;
    return generateMockData(yesProb, seriesEndMs);
  }, [yesProb, seriesEndMs]);

  if (!chartData) {
    return (
      <div
        className="mt-6 h-72 w-full min-h-[288px] min-w-0 rounded-lg bg-muted/50 animate-pulse"
        aria-hidden
      />
    );
  }

  return <PremiumChanceLineChart variant="detail" data={chartData} />;
}
