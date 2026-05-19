import type { Abi } from "abitype";

/** Mirrors `MarketRegistry.SettlementRail` (uint8 on-chain). */
export type SettlementRail = "USDC" | "EURC";

export const MARKET_CATEGORY_TABS = ["All", "Sports", "Crypto", "Politics", "Science", "Entertainment", "Other"] as const;
export type MarketCategoryTab = (typeof MARKET_CATEGORY_TABS)[number];

/** Feed filter for on-chain settlement rail (MarketRegistry.marketSettlementRail). */
export const MARKET_RAIL_TABS = ["All", "USDC", "EURC"] as const;
export type MarketRailTab = (typeof MARKET_RAIL_TABS)[number];

export function railFromUint8(v: bigint | number | undefined): SettlementRail {
  if (v === undefined) return "USDC";
  return Number(v) === 1 ? "EURC" : "USDC";
}

export function ammContractName(rail: SettlementRail): "PredictionMarketAMM_USDC" | "PredictionMarketAMM_EURC" {
  return rail === "EURC" ? "PredictionMarketAMM_EURC" : "PredictionMarketAMM_USDC";
}

export function collateralContractName(rail: SettlementRail): "MockUSDC" | "MockEURC" {
  return rail === "EURC" ? "MockEURC" : "MockUSDC";
}

export function settlementRailEnumArg(rail: SettlementRail): number {
  return rail === "EURC" ? 1 : 0;
}

/** Minimal ERC20 ABI for mint detection (localhost mocks expose mint). */
export function collateralAbiHasMint(abi: Abi): boolean {
  return abi.some((item: { type?: string; name?: string }) => item?.type === "function" && item?.name === "mint");
}
