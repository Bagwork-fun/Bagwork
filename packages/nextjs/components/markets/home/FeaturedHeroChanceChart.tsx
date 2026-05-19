"use client";

import { PremiumChanceLineChart } from "~~/components/markets/charts/PremiumChanceLineChart";
import type { FeaturedHeroChartPack } from "@/lib/mock-yes-chance-history";

type Props = {
  pack: FeaturedHeroChartPack;
};

export function FeaturedHeroChanceChart({ pack }: Props) {
  return <PremiumChanceLineChart variant="hero" pack={pack} />;
}
