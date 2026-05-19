"use client";

import { useEffect, useMemo } from "react";
import Link from "next/link";
import { useReadContract } from "wagmi";
import type { Abi } from "viem";
import { BookmarkIcon, LinkIcon } from "@heroicons/react/24/outline";

import { Spinner } from "@/components/ui/spinner";
import { FeaturedHeroChanceChart } from "~~/components/markets/home/FeaturedHeroChanceChart";
import { computeConditionId } from "@/lib/market-tokens";
import { getFeaturedHeroChartData } from "@/lib/mock-yes-chance-history";
import { parseYesNoFromProbability, formatOdds } from "@/lib/prices";
import { ammContractName, railFromUint8, type SettlementRail } from "@/lib/marketRails";
import type { MarketMetadata } from "~~/hooks/markets/useMarketMetadata";
import { useMarketIpfsCid, useMarketMetadata } from "~~/hooks/markets/useMarketMetadata";
import { useDeployedContractInfo, useScaffoldReadContract } from "~~/hooks/scaffold-eth";

interface Props {
  questionId: `0x${string}`;
  registryAddress?: `0x${string}`;
  registryAbi?: Abi;
  onMetadataLoaded?: (
    questionId: `0x${string}`,
    meta: Pick<MarketMetadata, "category" | "settlementAsset" | "title">,
  ) => void;
}

export function FeaturedMarketCard({ questionId, registryAddress, registryAbi, onMetadataLoaded }: Props) {
  const ipfsCid = useMarketIpfsCid(questionId);
  const { data: metadata, isLoading: metadataLoading } = useMarketMetadata(questionId);

  const { data: adapterInfo } = useDeployedContractInfo({ contractName: "AiCTFAdapter" });

  const { data: railRaw } = useScaffoldReadContract({
    contractName: "MarketRegistry",
    functionName: "marketSettlementRail",
    args: [questionId],
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

  const outcomeSlotCount = marketInfo?.exists ? marketInfo.outcomeCount : undefined;
  const adapterAddr = adapterInfo?.address as `0x${string}` | undefined;
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

  const chartPack = useMemo(
    () => getFeaturedHeroChartData(questionId, yesProbability != null ? yesPrice : 0.5),
    [questionId, yesProbability, yesPrice],
  );

  useEffect(() => {
    if (!metadata) return;
    onMetadataLoaded?.(questionId, {
      category: metadata.category,
      settlementAsset: metadata.settlementAsset,
      title: metadata.title,
    });
  }, [metadata, questionId, onMetadataLoaded]);

  const resolutionTime =
    metadata?.resolutionTime != null ? new Date(metadata.resolutionTime * 1000) : marketInfo?.resolutionTime
      ? new Date(Number(marketInfo.resolutionTime) * 1000)
      : null;

  const title = metadata?.title ?? `Market ${questionId.slice(0, 10)}…`;
  const outcomes = metadata?.outcomes ?? ["Yes", "No"];
  const metadataPending = Boolean(ipfsCid) && metadataLoading && !metadata;
  const yesPct = Math.round(yesPrice * 100);
  const deltaPct = chartPack.deltaPct;

  const detailHref = `/markets/${questionId}`;

  return (
    <div className="rounded-2xl border border-[#e8e8ee] bg-white p-6 shadow-[0_1px_2px_rgba(0,0,0,0.04)] dark:border-border dark:bg-card dark:shadow-none">
      {/* Header — matches mimic / Polymarket hero */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-4">
          {metadataPending ? (
            <div className="flex size-14 shrink-0 items-center justify-center rounded-xl bg-muted">
              <Spinner className="size-5 text-muted-foreground" />
            </div>
          ) : metadata?.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- remote market images
            <img src={metadata.imageUrl} alt="" className="size-14 shrink-0 rounded-xl object-cover" />
          ) : (
            <div className="flex size-14 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-violet-300 to-blue-400 text-2xl text-white">
              🔮
            </div>
          )}
          <h2 className="text-[22px] font-semibold leading-tight text-[#0f1419] sm:text-[26px] dark:text-foreground">
            {title}
          </h2>
        </div>
        <div className="flex shrink-0 items-center gap-1 text-[#8b95a1] dark:text-muted-foreground">
          <Link
            href={detailHref}
            className="rounded-md p-2 hover:bg-gray-50 dark:hover:bg-muted"
            aria-label="Open market"
          >
            <LinkIcon className="size-5" />
          </Link>
          <Link
            href={detailHref}
            className="rounded-md p-2 hover:bg-gray-50 dark:hover:bg-muted"
            aria-label="Bookmark market"
          >
            <BookmarkIcon className="size-5" />
          </Link>
        </div>
      </div>

      {/* Body — left column + chart */}
      <div className="mt-4 grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,360px)_1fr] lg:gap-8">
        <div>
          <div className="flex flex-wrap items-baseline gap-2">
            <span className="text-[26px] font-bold tabular-nums text-[#2563eb] sm:text-[28px] dark:text-blue-400">
              {yesPct}% chance
            </span>
            <span
              className={`text-sm font-semibold tabular-nums ${
                deltaPct < 0 ? "text-[#ef4444]" : deltaPct > 0 ? "text-[#16a34a]" : "text-[#8b95a1]"
              }`}
            >
              {deltaPct === 0 ? "—" : `${deltaPct < 0 ? "▼" : "▲"} ${Math.abs(deltaPct)}%`}
            </span>
          </div>
          <p className="mt-1 text-xs text-[#8b95a1] dark:text-muted-foreground">
            Settles {rail}
            {resolutionTime ? (
              <>
                {" "}
                · Ends {resolutionTime.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
              </>
            ) : null}
          </p>

          <div className="mt-4 grid grid-cols-2 gap-3">
            <Link
              href={detailHref}
              className="rounded-lg bg-[#e8f5ec] py-3 text-center text-sm font-semibold text-[#16a34a] transition hover:bg-[#daefdf] dark:bg-emerald-950/50 dark:text-emerald-400 dark:hover:bg-emerald-950/80"
            >
              {outcomes[0] ?? "Yes"} {formatOdds(yesPrice)}
            </Link>
            <Link
              href={detailHref}
              className="rounded-lg bg-[#fdecec] py-3 text-center text-sm font-semibold text-[#ef4444] transition hover:bg-[#fadcdc] dark:bg-red-950/40 dark:text-red-400 dark:hover:bg-red-950/65"
            >
              {outcomes[1] ?? "No"} {formatOdds(noPrice)}
            </Link>
          </div>

          <Link
            href={detailHref}
            className="mt-5 inline-block text-sm font-medium text-[#2563eb] underline-offset-4 hover:underline dark:text-blue-400"
          >
            View full market →
          </Link>
        </div>

        <FeaturedHeroChanceChart pack={chartPack} />
      </div>

      {/* Footer */}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-[#eef0f3] pt-4 text-sm text-[#8b95a1] dark:border-border dark:text-muted-foreground">
        <span className="tabular-nums">{rail} pool</span>
        <span className="flex flex-wrap items-center gap-2">
          {resolutionTime ? (
            <>
              Ends{" "}
              {resolutionTime.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
              <span className="text-[#cfd4da] dark:text-border">·</span>
            </>
          ) : null}
          <span className="flex items-center gap-1 font-medium text-[#0f1419] dark:text-foreground">
            <span
              className="inline-block size-3 bg-[#0f1419] dark:bg-foreground"
              style={{ clipPath: "polygon(0 50%, 50% 0, 100% 50%, 50% 100%)" }}
              aria-hidden
            />
            Bagwork
          </span>
        </span>
      </div>
    </div>
  );
}
