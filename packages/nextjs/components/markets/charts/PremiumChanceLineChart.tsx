"use client";

import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceDot,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import {
  CHART_AXIS_TICK_MUTED,
  CHART_AXIS_TICK_X_WARM,
  CHART_AXIS_TICK_Y,
  CHART_ENDPOINT,
  CHART_GRID,
  CHART_HERO_YES_COLOR,
  CHART_LINE,
  CHART_NO_COLOR,
  CHART_YES_COLOR,
} from "@/lib/chart-theme";
import type { FeaturedHeroChartPack } from "@/lib/mock-yes-chance-history";

export type DualSeriesPoint = { t: number; Yes: number; No: number };

type HeroProps = {
  variant: "hero";
  pack: FeaturedHeroChartPack;
  className?: string;
};

type DetailProps = {
  variant: "detail";
  data: DualSeriesPoint[];
  className?: string;
};

type Props = HeroProps | DetailProps;

function HeroTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: { value?: number }[];
}) {
  if (!active || !payload?.length) return null;
  const raw = payload[0].value;
  const n = typeof raw === "number" ? raw : Number(raw);
  return (
    <div className="rounded-md border border-border/50 bg-background px-2 py-1.5 text-xs shadow-xl dark:bg-popover">
      <p className="font-semibold tabular-nums text-foreground">
        {Number.isFinite(n) ? `${n.toFixed(1)}%` : "—"}
      </p>
      <p className="text-[11px] text-muted-foreground">Yes chance</p>
    </div>
  );
}

function DetailTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: { name?: string; value?: number; color?: string }[];
  label?: unknown;
}) {
  if (!active || !payload?.length) return null;
  const dateLabel =
    typeof label === "number"
      ? new Date(label).toLocaleDateString(undefined, {
          month: "short",
          day: "numeric",
          year: "numeric",
        })
      : String(label ?? "");
  return (
    <div className="rounded-lg border border-border/50 bg-background px-2.5 py-1.5 text-xs shadow-xl">
      <p className="mb-1 font-medium text-foreground">{dateLabel}</p>
      {payload.map(p => (
        <p key={p.name} className="tabular-nums text-muted-foreground">
          <span style={{ color: p.color }}>{p.name}</span>{" "}
          {typeof p.value === "number" ? `${p.value}%` : p.value}
        </p>
      ))}
    </div>
  );
}

export function PremiumChanceLineChart(props: Props) {
  const className = props.className ?? "h-[280px] w-full min-w-0 sm:h-[300px] lg:h-[320px]";

  if (props.variant === "hero") {
    const { pack } = props;
    const { data, yMax, yTicks, xTicks } = pack;
    const last = data[data.length - 1];
    const lineColor = CHART_HERO_YES_COLOR;

    return (
      <div className={className}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 20, right: 40, left: 0, bottom: 20 }}>
            <CartesianGrid
              {...CHART_GRID}
              stroke="#e5e7eb"
              className="dark:[&_line]:stroke-border"
            />
            <YAxis
              domain={[0, yMax]}
              ticks={yTicks}
              tickFormatter={v => `${v}%`}
              orientation="right"
              axisLine={false}
              tickLine={false}
              tick={CHART_AXIS_TICK_Y}
              width={44}
            />
            <XAxis
              dataKey="d"
              axisLine={false}
              tickLine={false}
              tick={CHART_AXIS_TICK_X_WARM}
              ticks={xTicks}
              interval={0}
            />
            <Tooltip content={<HeroTooltip />} />
            <Line dataKey="v" stroke={lineColor} {...CHART_LINE} />
            {last ? (
              <ReferenceDot
                x={last.d}
                y={last.v}
                fill={lineColor}
                {...CHART_ENDPOINT}
              />
            ) : null}
          </LineChart>
        </ResponsiveContainer>
      </div>
    );
  }

  const { data } = props;
  const last = data[data.length - 1];
  const detailClass = props.className ?? "mt-6 h-72 w-full min-h-[288px] min-w-0";

  return (
    <div className={detailClass}>
      <ResponsiveContainer width="100%" height="100%" debounce={80}>
        <LineChart data={data} margin={{ top: 20, right: 50, left: 6, bottom: 8 }}>
          <CartesianGrid {...CHART_GRID} stroke="#e5e7eb" className="dark:[&_line]:stroke-border" />
          <XAxis
            dataKey="t"
            tickFormatter={(t: number) =>
              new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" })
            }
            tickLine={false}
            axisLine={false}
            tick={CHART_AXIS_TICK_MUTED}
            minTickGap={30}
          />
          <YAxis
            tickFormatter={(v: number) => `${v}%`}
            tickLine={false}
            axisLine={false}
            tick={CHART_AXIS_TICK_Y}
            width={52}
            domain={[0, 100]}
            ticks={[0, 25, 50, 75, 100]}
            orientation="right"
          />
          <Tooltip content={<DetailTooltip />} />
          <Line dataKey="Yes" stroke={CHART_YES_COLOR} {...CHART_LINE} />
          <Line dataKey="No" stroke={CHART_NO_COLOR} {...CHART_LINE} />
          {last ? (
            <>
              <ReferenceDot x={last.t} y={last.Yes} fill={CHART_YES_COLOR} {...CHART_ENDPOINT} />
              <ReferenceDot x={last.t} y={last.No} fill={CHART_NO_COLOR} {...CHART_ENDPOINT} />
            </>
          ) : null}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
