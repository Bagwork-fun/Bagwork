"use client";

import { useMemo } from "react";
import { Line, LineChart, ReferenceDot, ResponsiveContainer } from "recharts";

import { CHART_ENDPOINT, CHART_HERO_YES_COLOR, CHART_LINE } from "@/lib/chart-theme";
import { mockYesChanceHistory } from "@/lib/mock-yes-chance-history";

type Props = {
  questionId: `0x${string}`;
  yesPrice: number;
  className?: string;
};

export function MarketCardSparkline({ questionId, yesPrice, className }: Props) {
  const data = useMemo(() => {
    const series = mockYesChanceHistory(questionId, yesPrice, 24);
    return series.map((row, i) => ({ i, v: row.pct }));
  }, [questionId, yesPrice]);

  const last = data[data.length - 1];
  const lineColor = CHART_HERO_YES_COLOR;

  return (
    <div className={className ?? "h-14 w-full min-w-0"} aria-hidden>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 4, right: 6, left: 0, bottom: 4 }}>
          <Line dataKey="v" stroke={lineColor} {...CHART_LINE} strokeWidth={1.4} />
          {last ? (
            <ReferenceDot x={last.i} y={last.v} fill={lineColor} r={3} stroke="#fff" strokeWidth={1.2} />
          ) : null}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
