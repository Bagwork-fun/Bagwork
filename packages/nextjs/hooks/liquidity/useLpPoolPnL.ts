"use client";

import { useQuery } from "@tanstack/react-query";
import { type Address, decodeEventLog, parseAbi } from "viem";
import { useChainId, usePublicClient } from "wagmi";

import {
  depositsFromEvents,
  effectiveLpDeposited,
  type LpLiquidityEvent,
  type LpPnLSummaryOnChain,
} from "@/lib/lp-pnl";
import { ammContractName, type SettlementRail } from "@/lib/marketRails";
import { marketRegistryLogsFromBlock } from "@/lib/market-ipfs";
import { useDeployedContractInfo, useScaffoldReadContract } from "~~/hooks/scaffold-eth";

const LP_EVENTS_ABI = parseAbi([
  "event PoolCreated(bytes32 indexed conditionId, uint256 yesTokenId, uint256 noTokenId, uint256 usdcCollateral)",
  "event LiquidityAdded(bytes32 indexed conditionId, address indexed provider, uint256 usdcAmount, uint256 tokenAmount)",
  "event LiquidityRemoved(bytes32 indexed conditionId, address indexed provider, uint256 usdcAmount, uint256 tokenAmount)",
]);

export function useLpPoolPnL(conditionId: `0x${string}` | undefined, rail: SettlementRail, lpOwner?: Address) {
  const chainId = useChainId();
  const publicClient = usePublicClient({ chainId });
  const contractName = ammContractName(rail);
  const { data: ammInfo } = useDeployedContractInfo({ contractName });

  const { data: summaryRaw, isLoading: summaryLoading } = useScaffoldReadContract({
    contractName,
    functionName: "getLpPnLSummary",
    args: [conditionId],
    query: { enabled: !!conditionId },
  });

  const summary = summaryRaw as LpPnLSummaryOnChain | undefined;

  const eventsQuery = useQuery({
    queryKey: ["lpLiquidityEvents", rail, conditionId, lpOwner, ammInfo?.address],
    enabled: !!publicClient && !!conditionId && !!ammInfo?.address && !!lpOwner,
    queryFn: async (): Promise<LpLiquidityEvent[]> => {
      const fromBlock = marketRegistryLogsFromBlock(chainId);
      const toBlock = await publicClient!.getBlockNumber();
      const addr = ammInfo!.address as Address;

      const [created, added, removed] = await Promise.all([
        publicClient!.getLogs({
          address: addr,
          event: LP_EVENTS_ABI[0],
          args: { conditionId },
          fromBlock,
          toBlock,
        }),
        publicClient!.getLogs({
          address: addr,
          event: LP_EVENTS_ABI[1],
          args: { conditionId, provider: lpOwner },
          fromBlock,
          toBlock,
        }),
        publicClient!.getLogs({
          address: addr,
          event: LP_EVENTS_ABI[2],
          args: { conditionId, provider: lpOwner },
          fromBlock,
          toBlock,
        }),
      ]);

      const events: LpLiquidityEvent[] = [];
      for (const log of created) {
        const decoded = decodeEventLog({ abi: LP_EVENTS_ABI, data: log.data, topics: log.topics });
        if (decoded.eventName === "PoolCreated") {
          events.push({ kind: "deposit", usdcAmount: decoded.args.usdcCollateral });
        }
      }
      for (const log of added) {
        const decoded = decodeEventLog({ abi: LP_EVENTS_ABI, data: log.data, topics: log.topics });
        if (decoded.eventName === "LiquidityAdded") {
          events.push({ kind: "deposit", usdcAmount: decoded.args.usdcAmount });
        }
      }
      for (const log of removed) {
        const decoded = decodeEventLog({ abi: LP_EVENTS_ABI, data: log.data, topics: log.topics });
        if (decoded.eventName === "LiquidityRemoved") {
          events.push({ kind: "withdraw", usdcAmount: decoded.args.usdcAmount });
        }
      }
      return events;
    },
    staleTime: 60_000,
  });

  const eventNetDeposited = depositsFromEvents(eventsQuery.data ?? []);
  const effectiveDeposited = summary ? effectiveLpDeposited(summary, eventNetDeposited) : eventNetDeposited;

  const netPnl =
    summary && summary.totalDeposited > 0n
      ? summary.netPnl
      : summary
        ? summary.nav + summary.totalWithdrawn - effectiveDeposited
        : 0n;

  return {
    summary,
    effectiveDeposited,
    netPnl,
    eventNetDeposited,
    isLoading: summaryLoading || eventsQuery.isLoading,
  };
}
