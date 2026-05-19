"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";

import { fetchIpfsJson } from "@/lib/market-ipfs";
import { useMarketChainId } from "~~/hooks/markets/useMarketChainId";
import { lookupMarketIpfsCid, useMarketCidIndex } from "~~/hooks/markets/useMarketCidIndex";

export { useMarketChainId } from "~~/hooks/markets/useMarketChainId";

export interface MarketMetadata {
  title: string;
  description: string;
  outcomes: string[];
  resolutionTime: number;
  category: string;
  imageUrl?: string;
  settlementAsset?: string;
  resolutionReasoning?: string;
  aiResolutionSummary?: string;
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

/** Resolve IPFS CID from indexed MarketCreated logs or localStorage cache. */
export function useMarketIpfsCid(questionId: `0x${string}` | undefined) {
  const { data: cidIndex, isLoading: indexLoading } = useMarketCidIndex();

  const fromIndex = lookupMarketIpfsCid(cidIndex, questionId);
  if (fromIndex) return fromIndex;

  if (!questionId) return null;
  const stored = readStoredCid(questionId);
  if (stored) return stored;

  // Still loading on-chain index — treat as pending (not missing)
  if (indexLoading) return null;
  return null;
}

/** True while the on-chain CID index is still loading and no CID is cached locally. */
export function useMarketIpfsCidPending(questionId: `0x${string}` | undefined): boolean {
  const cid = useMarketIpfsCid(questionId);
  const { isLoading, isFetching } = useMarketCidIndex();
  return !!questionId && !cid && (isLoading || isFetching);
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
