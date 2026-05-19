"use client";

import { useEffect, useMemo } from "react";
import Link from "next/link";
import { useReadContract } from "wagmi";
import type { Abi } from "viem";

import { Card } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { MarketCardSparkline } from "~~/components/markets/charts/MarketCardSparkline";
import { computeConditionId } from "@/lib/market-tokens";
import { parseYesNoFromProbability, formatOdds } from "@/lib/prices";
import {
  ammContractName,
  railFromUint8,
  type SettlementRail,
} from "@/lib/marketRails";
import {
  type MarketMetadata,
  useMarketIpfsCid,
  useMarketMetadata,
} from "~~/hooks/markets/useMarketMetadata";
import { useDeployedContractInfo, useScaffoldReadContract } from "~~/hooks/scaffold-eth";

interface Props {
  questionId: `0x${string}`;
  registryAddress?: `0x${string}`;
  registryAbi?: Abi;
  onMetadataLoaded?: (
    questionId: `0x${string}`,
    meta: Pick<MarketMetadata, "category" | "settlementAsset">,
  ) => void;
}

const STATUS_LABELS: Record<number, string> = { 0: "Active", 1: "Proposed", 2: "Resolved" };

function OddsBar({ label, price }: { label: string; price: number }) {
  const pct = Math.round(price * 100);
  return (
    <div className="relative flex items-center justify-between rounded-md overflow-hidden h-8 px-2.5">
      <div
        className="absolute inset-y-0 left-0 rounded-md bg-border/50 dark:bg-border/30"
        style={{ width: `${Math.max(pct, 2)}%` }}
      />
      <span className="relative text-sm truncate z-10 font-medium">{label}</span>
      <span className="relative text-sm font-semibold ml-2 shrink-0 z-10">{formatOdds(price)}</span>
    </div>
  );
}

export function MarketCard({ questionId, registryAddress, registryAbi, onMetadataLoaded }: Props) {
  const ipfsCid = useMarketIpfsCid(questionId);
  const { data: metadata, isLoading: metadataLoading } = useMarketMetadata(questionId);

  const { data: adapterInfo } = useDeployedContractInfo({ contractName: "AiCTFAdapter" });

  const { data: railRaw } = useScaffoldReadContract({
    contractName: "MarketRegistry",
    functionName: "marketSettlementRail",
    args: [questionId],
    query: { enabled: !!registryAddress },
  });

  const rail: SettlementRail = railFromUint8(railRaw as bigint | undefined);
  const ammName = ammContractName(rail);

  const { data: ammInfo } = useDeployedContractInfo({ contractName: ammName });

  const { data: marketInfo } = useReadContract({
    address: registryAddress,
    abi: registryAbi ?? [],
    functionName: "getMarket",
    args: [questionId],
    query: { enabled: !!registryAddress },
  }) as { data: { outcomeCount: bigint; resolutionTime: bigint; status: number; exists: boolean } | undefined };

  const { data: questionInfo } = useReadContract({
    address: adapterInfo?.address,
    abi: adapterInfo?.abi ?? [],
    functionName: "getQuestion",
    args: [questionId],
    query: { enabled: !!adapterInfo?.address },
  }) as { data: { status: number; proposedAt: bigint; proposedPayouts: bigint[] } | undefined };

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

  const [yesPrice, noPrice] = useMemo(() => {
    return yesProbability != null ? parseYesNoFromProbability(yesProbability) : [0.5, 0.5];
  }, [yesProbability]);

  useEffect(() => {
    if (!metadata) return;
    onMetadataLoaded?.(questionId, {
      category: metadata.category,
      settlementAsset: metadata.settlementAsset,
    });
  }, [metadata, questionId, onMetadataLoaded]);

  const adapterStatus = questionInfo?.status ?? 0;
  const registryStatus = marketInfo?.status ?? 0;
  const statusIdx = adapterStatus >= 3 ? 2 : adapterStatus === 2 ? 2 : registryStatus <= 2 ? registryStatus : 0;

  const resolutionTime =
    metadata?.resolutionTime != null ? new Date(metadata.resolutionTime * 1000) : marketInfo?.resolutionTime
      ? new Date(Number(marketInfo.resolutionTime) * 1000)
      : null;

  const now = Date.now();
  const disputeEnd = questionInfo?.proposedAt ? Number(questionInfo.proposedAt) * 1000 + 2 * 60 * 60 * 1000 : null;

  const title = metadata?.title ?? `Market ${questionId.slice(0, 10)}…`;
  const outcomes = metadata?.outcomes ?? ["Yes", "No"];
  const metadataPending = Boolean(ipfsCid) && metadataLoading && !metadata;

  return (
    <Link href={`/markets/${questionId}`} className="block h-full group">
      <Card
        size="sm"
        className="gap-2 p-4 transition-shadow hover:shadow-sm min-h-[200px] justify-between h-full ring-1 ring-border/60"
      >
        <div className="flex items-center gap-3">
          {metadataPending ? (
            <div className="size-10 rounded-lg bg-muted flex items-center justify-center shrink-0">
              <Spinner className="size-4 text-muted-foreground" />
            </div>
          ) : metadata?.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- remote market images
            <img src={metadata.imageUrl} alt={title} className="size-10 rounded-lg object-cover shrink-0" />
          ) : (
            <div className="size-10 rounded-lg bg-muted flex items-center justify-center shrink-0 text-lg">🔮</div>
          )}
          <h2 className="font-semibold leading-snug line-clamp-2 text-card-foreground">{title}</h2>
        </div>

        <div className="flex flex-wrap gap-1.5">
          <span className="text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-md bg-muted border border-border">
            Settles {rail}
          </span>
          {metadata?.category ? (
            <span className="text-[10px] font-medium px-2 py-0.5 rounded-md border border-border/80 text-muted-foreground">
              {metadata.category}
            </span>
          ) : null}
        </div>

        <div className="flex flex-col gap-1.5">
          {outcomes.length === 2 ? (
            <>
              <OddsBar label={outcomes[0]} price={yesPrice} />
              <OddsBar label={outcomes[1]} price={noPrice} />
            </>
          ) : (
            outcomes.slice(0, 2).map((o, i) => <OddsBar key={o + i} label={o} price={outcomes.length > 0 ? 1 / outcomes.length : 0} />)
          )}
        </div>

        <MarketCardSparkline questionId={questionId} yesPrice={yesPrice} className="h-14 w-full -mx-0.5" />

        <div className="flex items-center justify-between text-[11px] font-medium text-muted-foreground uppercase tracking-wide pt-3 border-t border-border/70">
          <div className="flex items-center gap-2 normal-case">
            <span className="px-2 py-0.5 rounded-md border border-border bg-muted/40 text-secondary-foreground text-xs">
              {STATUS_LABELS[statusIdx] ?? "Active"}
            </span>
            {statusIdx === 1 && disputeEnd && disputeEnd > now && (
              <span className="text-amber-600 dark:text-amber-400 text-xs">{Math.ceil((disputeEnd - now) / 60000)}m</span>
            )}
          </div>
          {resolutionTime && (
            <span className="normal-case">{resolutionTime.toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
          )}
        </div>
      </Card>
    </Link>
  );
}
