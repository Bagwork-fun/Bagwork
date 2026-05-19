"use client";

import { useEffect, useState } from "react";
import { fetchIpfsJson, marketRegistryLogsFromBlock, parseMarketCreatedIpfsCid } from "@/lib/market-ipfs";
type MarketMetadata = { title?: string };
import { useMarketChainId } from "~~/hooks/markets/useMarketMetadata";
import { useScaffoldEventHistory } from "~~/hooks/scaffold-eth";

export function PortfolioMarketTitle({ questionId }: { questionId: `0x${string}` }) {
  const marketChainId = useMarketChainId();
  const [title, setTitle] = useState<string | null>(null);

  const { data: creationEvents } = useScaffoldEventHistory({
    contractName: "MarketRegistry",
    eventName: "MarketCreated",
    chainId: marketChainId,
    fromBlock: marketRegistryLogsFromBlock(marketChainId),
    filters: { questionId },
    enabled: !!questionId,
  });

  useEffect(() => {
    const cid = parseMarketCreatedIpfsCid(creationEvents?.[0]);
    if (!cid) {
      setTitle(null);
      return;
    }
    let cancelled = false;
    void fetchIpfsJson<MarketMetadata>(cid).then(data => {
      if (!cancelled) setTitle(data?.title ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, [creationEvents, questionId]);

  const label = title ?? `${questionId.slice(0, 10)}…${questionId.slice(-6)}`;
  return (
    <span className="line-clamp-1 max-w-[14rem] text-sm font-medium" title={title ?? questionId}>
      {label}
    </span>
  );
}
