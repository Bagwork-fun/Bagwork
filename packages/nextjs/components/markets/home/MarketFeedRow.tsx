"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useChainId, useReadContract } from "wagmi";

import { Spinner } from "@/components/ui/spinner";
import { computeConditionId } from "@/lib/market-tokens";
import { parseYesNoFromProbability } from "@/lib/prices";
import { ammContractName, railFromUint8, type SettlementRail } from "@/lib/marketRails";
import { fetchIpfsJson, marketRegistryLogsFromBlock, parseMarketCreatedIpfsCid } from "@/lib/market-ipfs";
import { useDeployedContractInfo, useScaffoldEventHistory, useScaffoldReadContract } from "~~/hooks/scaffold-eth";

interface MarketMetadata {
  title: string;
  category: string;
  outcomes: string[];
}

interface Props {
  questionId: `0x${string}`;
  index: number;
  isActive?: boolean;
}

export function MarketFeedRow({ questionId, index, isActive }: Props) {
  const chainId = useChainId();
  const [metadata, setMetadata] = useState<MarketMetadata | null>(null);
  const [ipfsCid, setIpfsCid] = useState<string | null>(null);

  const { data: registryInfo } = useDeployedContractInfo({ contractName: "MarketRegistry" });
  const { data: adapterInfo } = useDeployedContractInfo({ contractName: "AiCTFAdapter" });

  const { data: railRaw } = useScaffoldReadContract({
    contractName: "MarketRegistry",
    functionName: "marketSettlementRail",
    args: [questionId],
  });

  const rail: SettlementRail = railFromUint8(railRaw as bigint | undefined);
  const ammName = ammContractName(rail);
  const { data: ammInfo } = useDeployedContractInfo({ contractName: ammName });

  const { data: creationEvents } = useScaffoldEventHistory({
    contractName: "MarketRegistry",
    eventName: "MarketCreated",
    fromBlock: marketRegistryLogsFromBlock(chainId),
    filters: { questionId },
    enabled: !!questionId,
  });

  const { data: marketInfo } = useReadContract({
    address: registryInfo?.address,
    abi: registryInfo?.abi ?? [],
    functionName: "getMarket",
    args: [questionId],
  }) as { data: { outcomeCount: bigint; exists: boolean } | undefined };

  const adapterAddr = adapterInfo?.address as `0x${string}` | undefined;
  const outcomeSlotCount = marketInfo?.exists ? marketInfo.outcomeCount : undefined;
  const conditionId =
    adapterAddr && outcomeSlotCount != null ? computeConditionId(adapterAddr, questionId, outcomeSlotCount) : undefined;

  const { data: yesProbability } = useReadContract({
    address: ammInfo?.address,
    abi: ammInfo?.abi ?? [],
    functionName: "getYesProbability",
    args: [conditionId!],
    query: { enabled: !!ammInfo?.address && !!conditionId },
  }) as { data: bigint | undefined };

  const yesPrice = useMemo(() => {
    return yesProbability != null ? parseYesNoFromProbability(yesProbability)[0] : 0.5;
  }, [yesProbability]);

  useEffect(() => {
    const fromLog = parseMarketCreatedIpfsCid(creationEvents?.[0]);
    if (fromLog) {
      setIpfsCid(fromLog);
      return;
    }
    const stored = typeof window !== "undefined" ? localStorage.getItem(`market_cid_${questionId}`) : null;
    setIpfsCid(stored);
  }, [questionId, creationEvents]);

  useEffect(() => {
    if (!ipfsCid) return;
    let cancelled = false;
    void (async () => {
      const data = await fetchIpfsJson<MarketMetadata>(ipfsCid);
      if (cancelled || !data) return;
      setMetadata(data);
    })();
    return () => {
      cancelled = true;
    };
  }, [ipfsCid]);

  const title =
    metadata?.title ?? (ipfsCid ? "Loading…" : `Market ${questionId.slice(0, 8)}…`);
  const yesPct = Math.round(yesPrice * 100);

  return (
    <Link
      href={`/markets/${questionId}`}
      className={`group flex gap-3 rounded-lg py-2 text-sm transition-colors hover:bg-muted/60 ${
        isActive ? "bg-muted/80 ring-1 ring-border/60" : ""
      }`}
    >
      <span className="w-5 shrink-0 text-right font-semibold tabular-nums text-muted-foreground group-hover:text-foreground">
        {index}
      </span>
      <span className="min-w-0 flex-1 leading-snug text-foreground group-hover:underline">{title}</span>
      <span className="flex shrink-0 items-center gap-1 font-semibold tabular-nums">
        {yesProbability === undefined && registryInfo?.address ? (
          <Spinner className="size-3.5 text-muted-foreground" />
        ) : (
          <>
            {yesPct}%
            <span className="text-emerald-600 dark:text-emerald-400" aria-hidden>
              ↗
            </span>
          </>
        )}
      </span>
    </Link>
  );
}
