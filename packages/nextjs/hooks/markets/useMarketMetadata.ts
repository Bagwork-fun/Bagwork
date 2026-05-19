"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";

import { fetchIpfsJson, marketRegistryLogsFromBlock, parseMarketCreatedIpfsCid } from "@/lib/market-ipfs";
import { useScaffoldEventHistory, useTargetNetwork } from "~~/hooks/scaffold-eth";
import type { AllowedChainIds } from "~~/utils/scaffold-eth";

export interface MarketMetadata {
  title: string;
  description: string;
  outcomes: string[];
  resolutionTime: number;
  category: string;
  imageUrl?: string;
  settlementAsset?: string;
}

const METADATA_STALE_MS = 5 * 60_000;
const METADATA_GC_MS = 30 * 60_000;

function readStoredCid(questionId: string): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(`market_cid_${questionId}`);
}

export function marketMetadataQueryKey(ipfsCid: string | null) {
  return ["market-metadata", ipfsCid] as const;
}

async function loadMarketMetadata(ipfsCid: string): Promise<MarketMetadata | null> {
  return fetchIpfsJson<MarketMetadata>(ipfsCid);
}

/** Chain for market registry logs — scaffold target network, not the connected wallet chain. */
export function useMarketChainId(): AllowedChainIds {
  const { targetNetwork } = useTargetNetwork();
  return targetNetwork.id;
}

/** Resolve IPFS CID from MarketCreated log or localStorage cache. */
export function useMarketIpfsCid(questionId: `0x${string}` | undefined) {
  const chainId = useMarketChainId();

  const { data: creationEvents } = useScaffoldEventHistory({
    contractName: "MarketRegistry",
    eventName: "MarketCreated",
    chainId,
    fromBlock: marketRegistryLogsFromBlock(chainId),
    filters: questionId ? { questionId } : undefined,
    enabled: !!questionId,
  });

  const creationEvent = creationEvents?.[0];
  const fromLog = parseMarketCreatedIpfsCid(creationEvent);

  if (fromLog) return fromLog;
  if (!questionId) return null;
  return readStoredCid(questionId);
}

export function useMarketMetadata(questionId: `0x${string}` | undefined) {
  const ipfsCid = useMarketIpfsCid(questionId);

  return useQuery({
    queryKey: marketMetadataQueryKey(ipfsCid),
    queryFn: () => loadMarketMetadata(ipfsCid!),
    enabled: !!ipfsCid,
    staleTime: METADATA_STALE_MS,
    gcTime: METADATA_GC_MS,
    placeholderData: (previousData) => previousData,
  });
}

export function usePrefetchMarketMetadata() {
  const queryClient = useQueryClient();

  return async (questionId: `0x${string}`, ipfsCid?: string | null) => {
    let cid = ipfsCid;
    if (!cid) cid = readStoredCid(questionId);
    if (!cid) return;
    await queryClient.prefetchQuery({
      queryKey: marketMetadataQueryKey(cid),
      queryFn: () => loadMarketMetadata(cid),
      staleTime: METADATA_STALE_MS,
    });
  };
}
