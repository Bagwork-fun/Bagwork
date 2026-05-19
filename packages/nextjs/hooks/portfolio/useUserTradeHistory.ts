"use client";

import { useQuery } from "@tanstack/react-query";
import { type Address } from "viem";
import { useAccount, useChainId, usePublicClient } from "wagmi";

import { marketRegistryLogsFromBlock } from "@/lib/market-ipfs";
import { fetchUserRedemptions, fetchUserTrades, type RedemptionEvent } from "@/lib/user-trade-index";
import type { UserTradeEvent } from "@/lib/position-pnl";
import { useDeployedContractInfo } from "~~/hooks/scaffold-eth";

export function useUserTradeHistory(conditionIdFilter?: `0x${string}`) {
  const { address } = useAccount();
  const chainId = useChainId();
  const publicClient = usePublicClient({ chainId });

  const { data: ammUsdc } = useDeployedContractInfo({ contractName: "PredictionMarketAMM_USDC" });
  const { data: ammEurc } = useDeployedContractInfo({ contractName: "PredictionMarketAMM_EURC" });
  const { data: ctfInfo } = useDeployedContractInfo({ contractName: "ConditionalTokens" });

  const fromBlock = marketRegistryLogsFromBlock(chainId);

  const tradesQuery = useQuery({
    queryKey: ["userTrades", chainId, address, ammUsdc?.address, ammEurc?.address],
    enabled: !!publicClient && !!address && (!!ammUsdc?.address || !!ammEurc?.address),
    queryFn: async (): Promise<UserTradeEvent[]> => {
      const all = await fetchUserTrades(
        publicClient!,
        address as Address,
        ammUsdc?.address as Address | undefined,
        ammEurc?.address as Address | undefined,
        fromBlock,
      );
      if (!conditionIdFilter) return all;
      return all.filter(t => t.conditionId === conditionIdFilter);
    },
    staleTime: 30_000,
  });

  const redemptionsQuery = useQuery({
    queryKey: ["userRedemptions", chainId, address, ctfInfo?.address],
    enabled: !!publicClient && !!address && !!ctfInfo?.address,
    queryFn: async (): Promise<RedemptionEvent[]> => {
      const all = await fetchUserRedemptions(
        publicClient!,
        address as Address,
        ctfInfo!.address as Address,
        fromBlock,
      );
      if (!conditionIdFilter) return all;
      return all.filter(r => r.conditionId === conditionIdFilter);
    },
    staleTime: 30_000,
  });

  return {
    trades: tradesQuery.data ?? [],
    redemptions: redemptionsQuery.data ?? [],
    isLoading: tradesQuery.isLoading || redemptionsQuery.isLoading,
    isError: tradesQuery.isError || redemptionsQuery.isError,
    refetch: () => {
      void tradesQuery.refetch();
      void redemptionsQuery.refetch();
    },
  };
}
