/**
 * Deterministic mock “price history” for hero charts. Last sample matches the live yes probability.
 */
export function mockYesChanceHistory(
  questionId: `0x${string}`,
  endProbability: number,
  points = 36,
): { label: string; pct: number }[] {
  const end = Math.min(0.99, Math.max(0.01, endProbability));
  const endPct = end * 100;

  let h = 2166136261;
  for (let i = 2; i < questionId.length; i++) {
    h = Math.imul(h ^ questionId.charCodeAt(i), 16777619);
  }

  const rnd = (() => {
    let state = h >>> 0;
    return () => {
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      return (state >>> 0) / 4294967296;
    };
  })();

  const startPct = 12 + rnd() * 76;
  const waves = 2 + (Math.abs(h) % 5);
  const amp = 4 + rnd() * 10;

  const out: { label: string; pct: number }[] = [];
  for (let i = 0; i < points; i++) {
    const t = points === 1 ? 1 : i / (points - 1);
    const base = startPct * (1 - t) + endPct * t;
    const wobble = Math.sin(t * Math.PI * waves + (h & 15) * 0.08) * amp * Math.sin(t * Math.PI);
    let pct = base + wobble;
    pct = Math.min(97.5, Math.max(2.5, pct));
    out.push({ label: `t${i + 1}`, pct });
  }

  out[0].pct = Math.min(97.5, Math.max(2.5, startPct));
  out[out.length - 1].pct = endPct;

  return out;
}

function pickYAxis(maxV: number): { yMax: number; yTicks: number[] } {
  const v = Math.ceil(maxV);
  if (v <= 12) return { yMax: 15, yTicks: [0, 5, 10, 15] };
  if (v <= 25) return { yMax: 30, yTicks: [0, 10, 20, 30] };
  if (v <= 38) return { yMax: 50, yTicks: [0, 25, 50] };
  if (v <= 55) return { yMax: 60, yTicks: [0, 20, 40, 60] };
  if (v <= 72) return { yMax: 80, yTicks: [0, 20, 40, 60, 80] };
  return { yMax: 100, yTicks: [0, 25, 50, 75, 100] };
}

export interface FeaturedHeroChartPack {
  data: { d: string; v: number }[];
  yMax: number;
  yTicks: number[];
  deltaPct: number;
  xTicks: string[];
}

/** Polymarket-style chart rows: dated x-axis, percent y. End matches live odds. */
export function getFeaturedHeroChartData(
  questionId: `0x${string}`,
  endProbability: number,
  pointCount = 14,
): FeaturedHeroChartPack {
  const series = mockYesChanceHistory(questionId, endProbability, pointCount);
  const now = new Date();
  const data = series.map((row, i) => {
    const dt = new Date(now);
    dt.setDate(dt.getDate() - (pointCount - 1 - i));
    const d = dt.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    return { d, v: Math.round(row.pct * 10) / 10 };
  });

  const exactEnd = Math.round(Math.min(1, Math.max(0, endProbability)) * 100);
  data[data.length - 1].v = exactEnd;
  const maxAfter = Math.max(...data.map(x => x.v), 1);
  const { yMax, yTicks } = pickYAxis(maxAfter);
  const deltaPct = Math.round(data[data.length - 1].v - data[0].v);

  const idx = [2, 5, 8, 11].filter(i => i < data.length).map(i => data[i].d);
  const xTicks = idx.length >= 4 ? idx : data.filter((_, i) => i % 4 === 0).map(r => r.d);

  return { data, yMax, yTicks, deltaPct, xTicks };
}
