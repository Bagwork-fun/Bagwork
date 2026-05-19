"use client";

import { useMemo } from "react";
import { type Address } from "viem";
import { useAccount, useReadContract, useReadContracts } from "wagmi";

import { computeConditionId, computeOutcomeTokenIds } from "@/lib/market-tokens";
import { COLLATERAL_DECIMALS } from "@/lib/market-decimals";
import { ammContractName, collateralContractName, railFromUint8, type SettlementRail } from "@/lib/marketRails";
import {
  buildOutcomeLedger,
  computePositionPnL,
  redeemValueForBalances,
  type UserTradeEvent,
} from "@/lib/position-pnl";
import { useUserTradeHistory } from "@/hooks/portfolio/useUserTradeHistory";
import { useDeployedContractInfo } from "~~/hooks/scaffold-eth";

export type PositionStatus = "open" | "resolved";

export type PortfolioPositionRow = {
  questionId: `0x${string}`;
  conditionId: `0x${string}`;
  side: "Yes" | "No";
  outcome: number;
  rail: SettlementRail;
  shares: bigint;
  status: PositionStatus;
  costBasis: bigint;
  markValue: bigint;
  unrealizedPnL: bigint;
  realizedPnL: bigint;
  totalPnL: bigint;
  avgEntry: bigint;
  redeemable: bigint;
  marketResolved: boolean;
};

export type PortfolioTotals = {
  positionValue: bigint;
  unrealizedPnL: bigint;
  realizedPnL: bigint;
  totalPnL: bigint;
};

type MarketMeta = {
  questionId: `0x${string}`;
  conditionId: `0x${string}`;
  rail: SettlementRail;
  outcomeCount: bigint;
  adapterStatus: number;
  yesTokenId: bigint;
  noTokenId: bigint;
  collateralAddress: Address;
};

function redemptionPnLByCondition(
  redemptions: { conditionId: `0x${string}`; payout: bigint }[],
  trades: UserTradeEvent[],
): Map<string, bigint> {
  const map = new Map<string, bigint>();
  for (const r of redemptions) {
    const key = r.conditionId;
    const yesLedger = buildOutcomeLedger(trades, r.conditionId, 0);
    const noLedger = buildOutcomeLedger(trades, r.conditionId, 1);
    const totalCost = yesLedger.totalCost + noLedger.totalCost;
    const prev = map.get(key) ?? 0n;
    map.set(key, prev + r.payout - totalCost);
  }
  return map;
}

export function usePortfolioPositions() {
  const { address } = useAccount();
  const { trades, redemptions, isLoading: historyLoading } = useUserTradeHistory();

  const { data: registryInfo } = useDeployedContractInfo({ contractName: "MarketRegistry" });
  const { data: adapterInfo } = useDeployedContractInfo({ contractName: "AiCTFAdapter" });
  const { data: ctfInfo } = useDeployedContractInfo({ contractName: "ConditionalTokens" });
  const { data: usdcInfo } = useDeployedContractInfo({ contractName: "MockUSDC" });
  const { data: eurcInfo } = useDeployedContractInfo({ contractName: "MockEURC" });
  const { data: ammUsdcInfo } = useDeployedContractInfo({ contractName: "PredictionMarketAMM_USDC" });
  const { data: ammEurcInfo } = useDeployedContractInfo({ contractName: "PredictionMarketAMM_EURC" });

  const { data: allMarkets, isPending: marketsPending } = useReadContract({
    address: registryInfo?.address,
    abi: registryInfo?.abi ?? [],
    functionName: "getAllMarkets",
  }) as { data: readonly `0x${string}`[] | undefined; isPending: boolean };

  const ids = allMarkets ?? [];
  const adapterAddr = adapterInfo?.address as Address | undefined;
  const registryAddr = registryInfo?.address as Address | undefined;

  const detailContracts = useMemo(() => {
    if (!registryAddr || ids.length === 0) return [];
    return ids.flatMap(qid => [
      {
        address: registryAddr,
        abi: registryInfo?.abi ?? [],
        functionName: "getMarket" as const,
        args: [qid] as const,
      },
      {
        address: registryAddr,
        abi: registryInfo?.abi ?? [],
        functionName: "marketSettlementRail" as const,
        args: [qid] as const,
      },
    ]);
  }, [ids, registryAddr, registryInfo?.abi]);

  const { data: detailResults, isPending: detailsPending } = useReadContracts({
    contracts: detailContracts,
    query: { enabled: detailContracts.length > 0 },
  });

  const markets: MarketMeta[] = useMemo(() => {
    if (!adapterAddr || !detailResults) return [];
    const list: MarketMeta[] = [];
    for (let i = 0; i < ids.length; i++) {
      const qid = ids[i];
      const marketRes = detailResults[i * 2];
      const railRes = detailResults[i * 2 + 1];
      if (marketRes?.status !== "success" || railRes?.status !== "success") continue;
      const m = marketRes.result as { outcomeCount: bigint; exists: boolean; status: number };
      if (!m?.exists) continue;
      const rail = railFromUint8(railRes.result as bigint);
      const collateralAddress = (rail === "EURC" ? eurcInfo?.address : usdcInfo?.address) as Address;
      const conditionId = computeConditionId(adapterAddr, qid, m.outcomeCount);
      if (!conditionId) continue;
      const { yesTokenId, noTokenId } = computeOutcomeTokenIds(collateralAddress, conditionId);
      if (!yesTokenId || !noTokenId) continue;
      list.push({
        questionId: qid,
        conditionId,
        rail,
        outcomeCount: m.outcomeCount,
        adapterStatus: m.status,
        yesTokenId,
        noTokenId,
        collateralAddress,
      });
    }
    return list;
  }, [ids, adapterAddr, detailResults, usdcInfo?.address, eurcInfo?.address]);

  const ctfAbi = (ctfInfo?.abi ?? []) as readonly object[];
  const ctfAddr = ctfInfo?.address as Address | undefined;

  const balanceContracts = useMemo(() => {
    if (!ctfAddr || !address || markets.length === 0) return [];
    return markets.flatMap(m => [
      {
        abi: ctfAbi,
        address: ctfAddr,
        functionName: "balanceOf" as const,
        args: [address, m.yesTokenId] as const,
        meta: { ...m, side: "Yes" as const, outcome: 0 },
      },
      {
        abi: ctfAbi,
        address: ctfAddr,
        functionName: "balanceOf" as const,
        args: [address, m.noTokenId] as const,
        meta: { ...m, side: "No" as const, outcome: 1 },
      },
    ]);
  }, [markets, ctfAddr, ctfAbi, address]);

  const { data: balanceResults, isPending: balsPending } = useReadContracts({
    contracts: balanceContracts.map(({ meta: _m, ...c }) => c),
    query: { enabled: balanceContracts.length > 0 && !!address },
  });

  const resolvedMarkets = markets.filter(m => m.adapterStatus === 3);
  const payoutContracts = useMemo(() => {
    if (!ctfAddr || resolvedMarkets.length === 0) return [];
    return resolvedMarkets.flatMap(m => [
      {
        abi: ctfAbi,
        address: ctfAddr,
        functionName: "payoutDenominator" as const,
        args: [m.conditionId] as const,
        conditionId: m.conditionId,
      },
      {
        abi: ctfAbi,
        address: ctfAddr,
        functionName: "payoutNumerators" as const,
        args: [m.conditionId, 0n] as const,
        conditionId: m.conditionId,
        outcomeIndex: 0,
      },
      {
        abi: ctfAbi,
        address: ctfAddr,
        functionName: "payoutNumerators" as const,
        args: [m.conditionId, 1n] as const,
        conditionId: m.conditionId,
        outcomeIndex: 1,
      },
    ]);
  }, [resolvedMarkets, ctfAddr, ctfAbi]);

  const { data: payoutResults } = useReadContracts({
    contracts: payoutContracts.map(({ conditionId: _c, outcomeIndex: _o, ...c }) => c),
    query: { enabled: payoutContracts.length > 0 },
  });

  const payoutByCondition = useMemo(() => {
    const map = new Map<string, { denom: bigint; nums: [bigint, bigint] }>();
    for (let i = 0; i < resolvedMarkets.length; i++) {
      const m = resolvedMarkets[i];
      const base = i * 3;
      const denomRes = payoutResults?.[base];
      const n0 = payoutResults?.[base + 1];
      const n1 = payoutResults?.[base + 2];
      if (denomRes?.status !== "success" || n0?.status !== "success" || n1?.status !== "success") continue;
      const denom = denomRes.result as bigint;
      if (denom === 0n) continue;
      map.set(m.conditionId, {
        denom,
        nums: [n0.result as bigint, n1.result as bigint],
      });
    }
    return map;
  }, [resolvedMarkets, payoutResults]);

  const openLegs = useMemo(() => {
    const legs: {
      market: MarketMeta;
      side: "Yes" | "No";
      outcome: number;
      shares: bigint;
    }[] = [];
    balanceResults?.forEach((res, i) => {
      const cfg = balanceContracts[i];
      if (!cfg?.meta || res.status !== "success") return;
      const shares = res.result as bigint;
      if (shares === 0n) return;
      const { meta } = cfg;
      if (meta.adapterStatus === 3) return;
      legs.push({ market: meta, side: meta.side, outcome: meta.outcome, shares });
    });
    return legs;
  }, [balanceResults, balanceContracts]);

  const sellPriceContracts = useMemo(() => {
    return openLegs.map(leg => {
      const amm = leg.market.rail === "EURC" ? ammEurcInfo : ammUsdcInfo;
      return {
        address: amm?.address as Address,
        abi: amm?.abi ?? [],
        functionName: "getSellPrice" as const,
        args: [leg.market.conditionId, BigInt(leg.outcome), leg.shares] as const,
        leg,
      };
    });
  }, [openLegs, ammUsdcInfo, ammEurcInfo]);

  const { data: sellPriceResults, isPending: pricesPending } = useReadContracts({
    contracts: sellPriceContracts.map(({ leg: _l, ...c }) => c),
    query: { enabled: sellPriceContracts.length > 0 },
  });

  const redemptionRealized = useMemo(() => redemptionPnLByCondition(redemptions, trades), [redemptions, trades]);

  const rows: PortfolioPositionRow[] = useMemo(() => {
    const result: PortfolioPositionRow[] = [];

    openLegs.forEach((leg, i) => {
      const priceRes = sellPriceResults?.[i];
      const markValue = priceRes?.status === "success" ? (priceRes.result as bigint) : 0n;
      const ledger = buildOutcomeLedger(trades, leg.market.conditionId, leg.outcome);
      const pnl = computePositionPnL({ shares: leg.shares, ledger, markValue });
      const avgEntry = leg.shares > 0n ? (pnl.costBasis * 10n ** BigInt(COLLATERAL_DECIMALS)) / leg.shares : 0n;

      result.push({
        questionId: leg.market.questionId,
        conditionId: leg.market.conditionId,
        side: leg.side,
        outcome: leg.outcome,
        rail: leg.market.rail,
        shares: leg.shares,
        status: "open",
        costBasis: pnl.costBasis,
        markValue: pnl.markValue,
        unrealizedPnL: pnl.unrealized,
        realizedPnL: pnl.realized,
        totalPnL: pnl.totalPnL,
        avgEntry,
        redeemable: 0n,
        marketResolved: false,
      });
    });

    balanceResults?.forEach((res, i) => {
      const cfg = balanceContracts[i];
      if (!cfg?.meta || res.status !== "success") return;
      const shares = res.result as bigint;
      if (shares === 0n) return;
      const m = cfg.meta;
      if (m.adapterStatus !== 3) return;

      const payout = payoutByCondition.get(m.conditionId);
      const markValue = payout ? redeemValueForBalances(
        cfg.meta.side === "Yes" ? shares : 0n,
        cfg.meta.side === "No" ? shares : 0n,
        payout.nums,
        payout.denom,
      ) : 0n;
      const ledger = buildOutcomeLedger(trades, m.conditionId, cfg.meta.outcome);
      const pnl = computePositionPnL({ shares, ledger, markValue });

      result.push({
        questionId: m.questionId,
        conditionId: m.conditionId,
        side: cfg.meta.side,
        outcome: cfg.meta.outcome,
        rail: m.rail,
        shares,
        status: "resolved",
        costBasis: pnl.costBasis,
        markValue: pnl.markValue,
        unrealizedPnL: markValue > 0n ? pnl.unrealized : 0n,
        realizedPnL: pnl.realized,
        totalPnL: pnl.realized + (markValue > 0n ? pnl.unrealized : 0n),
        avgEntry: shares > 0n ? (pnl.costBasis * 10n ** BigInt(COLLATERAL_DECIMALS)) / shares : 0n,
        redeemable: markValue,
        marketResolved: true,
      });
    });

    return result;
  }, [
    openLegs,
    sellPriceResults,
    trades,
    balanceResults,
    balanceContracts,
    payoutByCondition,
    redemptionRealized,
  ]);

  const totals: PortfolioTotals = useMemo(() => {
    let positionValue = 0n;
    let unrealizedPnL = 0n;
    let realizedPnL = 0n;
    for (const r of rows) {
      positionValue += r.status === "resolved" && r.redeemable > 0n ? r.redeemable : r.markValue;
      unrealizedPnL += r.unrealizedPnL;
      realizedPnL += r.realizedPnL;
    }
    for (const pnl of redemptionRealized.values()) {
      realizedPnL += pnl;
    }
    return { positionValue, unrealizedPnL, realizedPnL, totalPnL: unrealizedPnL + realizedPnL };
  }, [rows, redemptionRealized]);

  const isLoading =
    !address ||
    marketsPending ||
    (detailContracts.length > 0 && detailsPending) ||
    (balanceContracts.length > 0 && balsPending) ||
    historyLoading ||
    (sellPriceContracts.length > 0 && pricesPending);

  return {
    rows,
    openRows: rows.filter(r => r.status === "open"),
    resolvedRows: rows.filter(r => r.status === "resolved"),
    trades,
    totals,
    isLoading,
    markets,
  };
}
