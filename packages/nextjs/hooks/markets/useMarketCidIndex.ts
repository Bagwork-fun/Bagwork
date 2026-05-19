"use client";

import { useQuery } from "@tanstack/react-query";
import type { Abi, Address } from "viem";
import { usePublicClient } from "wagmi";

import { marketRegistryLogsFromBlock, parseMarketCreatedIpfsCid } from "@/lib/market-ipfs";
import { useMarketChainId } from "~~/hooks/markets/useMarketChainId";
import { useDeployedContractInfo } from "~~/hooks/scaffold-eth";
import type { AllowedChainIds } from "~~/utils/scaffold-eth";

const CID_INDEX_STALE_MS = 5 * 60_000;
const LOG_BATCH_BLOCKS = 10_000n;

export type MarketCidIndex = Record<string, string>;

function normalizeQuestionId(id: string): string {
  return id.toLowerCase();
}

async function fetchMarketCreatedCidIndex(
  publicClient: NonNullable<ReturnType<typeof usePublicClient>>,
  registryAddress: Address,
  registryAbi: Abi,
  chainId: AllowedChainIds,
): Promise<MarketCidIndex> {
  const fromBlock = marketRegistryLogsFromBlock(chainId);
  const toBlock = await publicClient.getBlockNumber();
  const index: MarketCidIndex = {};

  for (let start = fromBlock; start <= toBlock; start += LOG_BATCH_BLOCKS) {
    const end = start + LOG_BATCH_BLOCKS - 1n > toBlock ? toBlock : start + LOG_BATCH_BLOCKS - 1n;
    const logs = await publicClient.getContractEvents({
      address: registryAddress,
      abi: registryAbi,
      eventName: "MarketCreated",
      fromBlock: start,
      toBlock: end,
    });

    for (const log of logs) {
      const cidFromArgs =
        typeof log.args === "object" && log.args != null && "ipfsCid" in log.args
          ? (log.args as { ipfsCid?: string }).ipfsCid
          : null;
      const cid = cidFromArgs ?? parseMarketCreatedIpfsCid(log);
      const qid =
        typeof log.args === "object" && log.args != null && "questionId" in log.args
          ? (log.args as { questionId?: string }).questionId
          : null;
      if (qid && cid) index[normalizeQuestionId(qid)] = cid;
    }
  }

  return index;
}

/** questionId → IPFS CID for all markets (one batched log scan, cached). */
export function useMarketCidIndex() {
  const chainId = useMarketChainId();
  const publicClient = usePublicClient({ chainId });
  const { data: registryInfo } = useDeployedContractInfo({
    contractName: "MarketRegistry",
    chainId,
  });

  return useQuery({
    queryKey: ["market-cid-index", chainId, registryInfo?.address],
    queryFn: () =>
      fetchMarketCreatedCidIndex(
        publicClient!,
        registryInfo!.address as Address,
        registryInfo!.abi as Abi,
        chainId,
      ),
    enabled: !!publicClient && !!registryInfo?.address,
    staleTime: CID_INDEX_STALE_MS,
    gcTime: 30 * 60_000,
  });
}

export function lookupMarketIpfsCid(
  index: MarketCidIndex | undefined,
  questionId: string | undefined,
): string | null {
  if (!questionId || !index) return null;
  return index[normalizeQuestionId(questionId)] ?? null;
}
