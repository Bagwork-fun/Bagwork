"use client";

import { useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { fetchIpfsJson } from "@/lib/market-ipfs";
import { useMarketChainId } from "~~/hooks/markets/useMarketChainId";
import {
  lookupMarketIpfsCid,
  useMarketCidIndex,
  type MarketCidIndex,
} from "~~/hooks/markets/useMarketCidIndex";

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

const METADATA_STALE_MS = 30 * 60_000;
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
  const { data: cidIndex } = useMarketCidIndex();

  const fromIndex = lookupMarketIpfsCid(cidIndex, questionId);
  if (fromIndex) return fromIndex;

  if (!questionId) return null;
  return readStoredCid(questionId);
}

/** True only on first load when CID is not yet known (not on background refetch). */
export function useMarketIpfsCidPending(questionId: `0x${string}` | undefined): boolean {
  const cid = useMarketIpfsCid(questionId);
  const { data: cidIndex, isLoading, isFetched } = useMarketCidIndex();
  if (cid) return false;
  if (!questionId) return false;
  return !isFetched && isLoading && !cidIndex;
}

export function useMarketMetadata(questionId: `0x${string}` | undefined) {
  const ipfsCid = useMarketIpfsCid(questionId);

  return useQuery({
    queryKey: marketMetadataQueryKey(ipfsCid),
    queryFn: () => loadMarketMetadata(ipfsCid!),
    enabled: !!ipfsCid,
    staleTime: METADATA_STALE_MS,
    gcTime: METADATA_GC_MS,
    refetchOnMount: false,
    placeholderData: previousData => previousData,
  });
}

export function usePrefetchMarketMetadata() {
  const queryClient = useQueryClient();
  const chainId = useMarketChainId();

  return useCallback(
    async (questionId: `0x${string}`, ipfsCid?: string | null) => {
      let cid = ipfsCid;
      if (!cid) {
        const queries = queryClient.getQueriesData<MarketCidIndex>({
          queryKey: ["market-cid-index", chainId],
        });
        const cachedIndex = queries.find(([, data]) => data != null)?.[1];
        cid = lookupMarketIpfsCid(cachedIndex, questionId) ?? readStoredCid(questionId);
      }
      if (!cid) return;

      const existing = queryClient.getQueryData<MarketMetadata>(marketMetadataQueryKey(cid));
      if (existing) return;

      await queryClient.prefetchQuery({
        queryKey: marketMetadataQueryKey(cid),
        queryFn: () => loadMarketMetadata(cid),
        staleTime: METADATA_STALE_MS,
      });
    },
    [queryClient, chainId],
  );
}
