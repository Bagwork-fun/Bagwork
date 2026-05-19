/** Kalshi-inspired chart tokens (light/dark via CSS variables where noted). */
export const CHART_GRID = {
  strokeDasharray: "2 4",
  vertical: false as const,
};

export const CHART_LINE = {
  type: "linear" as const,
  strokeWidth: 1.6,
  dot: false,
  isAnimationActive: false,
};

export const CHART_AXIS_TICK_Y = { fill: "#9ca3af", fontSize: 12 };
export const CHART_AXIS_TICK_X_WARM = { fill: "#a78670", fontSize: 13 };
export const CHART_AXIS_TICK_MUTED = { fill: "#9ca3af", fontSize: 12 };

/** Matches market page Yes button (teal-700 / teal-400). */
export const CHART_YES_COLOR = "#0f766e";
export const CHART_NO_COLOR = "var(--chart-2)";
export const CHART_HERO_YES_COLOR = "#0f766e";

export const CHART_ENDPOINT = {
  r: 4.5,
  stroke: "#fff",
  strokeWidth: 1.5,
};
