"use client";

import { useMarketIpfsCid, useMarketMetadata } from "~~/hooks/markets/useMarketMetadata";

export function PortfolioMarketTitle({ questionId }: { questionId: `0x${string}` }) {
  const ipfsCid = useMarketIpfsCid(questionId);
  const { data: metadata } = useMarketMetadata(questionId);

  const title = metadata?.title ?? `${questionId.slice(0, 10)}…${questionId.slice(-6)}`;
  const label = ipfsCid && !metadata?.title ? "Loading…" : title;

  return (
    <span className="line-clamp-1 max-w-[14rem] text-sm font-medium" title={metadata?.title ?? questionId}>
      {label}
    </span>
  );
}
