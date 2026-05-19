"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useReadContract, useReadContracts } from "wagmi";

import { MarketCard } from "~~/components/markets/MarketCard";
import { FeaturedMarketCarousel } from "~~/components/markets/home/FeaturedMarketCarousel";
import { HomeCategoryStrip } from "~~/components/markets/home/HomeCategoryStrip";
import { MarketFeedSidebar } from "~~/components/markets/home/MarketFeedSidebar";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { filterVisibleMarkets } from "@/lib/market-blocklist";
import { cn } from "@/lib/utils";
import {
  MARKET_RAIL_TABS,
  railFromUint8,
  type MarketCategoryTab,
  type MarketRailTab,
  type SettlementRail,
} from "@/lib/marketRails";
import { useDeployedContractInfo } from "~~/hooks/scaffold-eth";
import { useGlobalState } from "~~/services/store/store";

interface MarketMetadataLite {
  category?: string;
}

export function MarketFeed() {
  const setCreateMarketModalOpen = useGlobalState(s => s.setCreateMarketModalOpen);
  const [categoryTab, setCategoryTab] = useState<MarketCategoryTab>("All");
  const [railTab, setRailTab] = useState<MarketRailTab>("All");
  const [metaByQuestion, setMetaByQuestion] = useState<
    Record<string, MarketMetadataLite | undefined>
  >({});
  const [heroIdx, setHeroIdx] = useState(0);

  const handleMetaLoaded = useCallback((questionId: `0x${string}`, meta: MarketMetadataLite) => {
    setMetaByQuestion(prev => ({ ...prev, [questionId]: meta }));
  }, []);

  const { data: registryInfo } = useDeployedContractInfo({ contractName: "MarketRegistry" });

  const { data: allMarkets, refetch, isPending } = useReadContract({
    address: registryInfo?.address,
    abi: registryInfo?.abi ?? [],
    functionName: "getAllMarkets",
  }) as { data: `0x${string}`[] | undefined; refetch: () => void; isPending: boolean };

  const markets = useMemo(() => filterVisibleMarkets(allMarkets ?? []), [allMarkets]);

  const railReadContracts = useMemo(() => {
    if (!registryInfo?.address || markets.length === 0) return [];
    return markets.map(qId => ({
      address: registryInfo.address as `0x${string}`,
      abi: registryInfo.abi ?? [],
      functionName: "marketSettlementRail" as const,
      args: [qId] as const,
    }));
  }, [registryInfo?.address, registryInfo?.abi, markets]);

  const { data: railReadResults, isPending: railsPending } = useReadContracts({
    contracts: railReadContracts,
    query: { enabled: railReadContracts.length > 0 },
  });

  const railByQuestion = useMemo(() => {
    const map: Record<string, SettlementRail> = {};
    if (!railReadResults || markets.length === 0) return map;
    markets.forEach((qId, i) => {
      const row = railReadResults[i];
      if (row?.status === "success") map[qId] = railFromUint8(row.result as bigint);
    });
    return map;
  }, [markets, railReadResults]);

  const railFilterReady =
    railTab === "All" || railReadContracts.length === 0 || (!!railReadResults && !railsPending);

  const visibleMarkets = useMemo(() => {
    let list = markets;
    if (categoryTab !== "All") {
      list = list.filter(q => metaByQuestion[q]?.category?.trim() === categoryTab);
    }
    if (railTab !== "All" && railFilterReady) {
      list = list.filter(q => railByQuestion[q] === railTab);
    }
    return list;
  }, [markets, categoryTab, railTab, metaByQuestion, railByQuestion, railFilterReady]);

  const showRailFilterSpinner = railTab !== "All" && !railFilterReady;

  const listForHero = useMemo(() => {
    if (visibleMarkets.length > 0) return visibleMarkets;
    if (markets.length > 0) return markets;
    return [];
  }, [visibleMarkets, markets]);

  const heroCarouselIds = useMemo(() => listForHero.slice(0, 12), [listForHero]);

  const heroCarouselKey = heroCarouselIds.join(",");

  useEffect(() => {
    setHeroIdx(0);
  }, [heroCarouselKey]);

  const sidebarQuestionIds = useMemo(() => heroCarouselIds.slice(0, 8), [heroCarouselIds]);

  const activeHeroId = heroCarouselIds[heroIdx];

  const scrollToAllMarkets = useCallback(() => {
    document.getElementById("all-markets")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  const handleExploreAll = useCallback(() => {
    setCategoryTab("All");
    setRailTab("All");
    queueMicrotask(scrollToAllMarkets);
  }, [scrollToAllMarkets]);

  return (
    <>
      <HomeCategoryStrip value={categoryTab} onValueChange={setCategoryTab} />

      {!registryInfo?.address ? (
        <div className="flex justify-center py-24">
          <Spinner className="size-8" />
        </div>
      ) : markets.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-4 rounded-xl border bg-card py-24 ring-1 ring-border/40">
          <p className="text-muted-foreground">No markets yet.</p>
          <Button variant="outline" size="sm" type="button" onClick={() => setCreateMarketModalOpen(true)}>
            Create the first market
          </Button>
        </div>
      ) : (
        <>
          <div className="mb-10 grid gap-6 lg:grid-cols-12 lg:gap-8">
            <div className="lg:col-span-8">
              {heroCarouselIds.length > 0 ? (
                <FeaturedMarketCarousel
                  questionIds={heroCarouselIds}
                  registryAddress={registryInfo?.address}
                  registryAbi={registryInfo?.abi}
                  onMetadataLoaded={handleMetaLoaded}
                  onIndexChange={setHeroIdx}
                />
              ) : null}
            </div>
            <div className="lg:col-span-4">
              <MarketFeedSidebar
                sidebarQuestionIds={sidebarQuestionIds}
                activeHeroId={activeHeroId}
                onExploreAll={handleExploreAll}
              />
            </div>
          </div>

          <section id="all-markets" className="scroll-mt-28 border-t border-border/80 pt-8">
            <h2 className="mb-5 text-xl font-semibold tracking-tight text-foreground sm:text-2xl">All markets</h2>

            <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
              <div className="inline-flex rounded-full border border-border/80 bg-muted/30 p-0.5">
                {MARKET_RAIL_TABS.map(tab => (
                  <button
                    key={tab}
                    type="button"
                    onClick={() => setRailTab(tab)}
                    className={cn(
                      "rounded-full px-3 py-1 text-xs font-medium transition-colors sm:px-4 sm:py-1.5 sm:text-[13px]",
                      railTab === tab
                        ? "bg-background text-foreground shadow-sm ring-1 ring-border/60"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {tab === "All" ? "All rails" : tab}
                  </button>
                ))}
              </div>
            </div>

            {(categoryTab !== "All" || railTab !== "All") && (
              <p className="mb-6 text-xs text-muted-foreground">
                {categoryTab !== "All" && (
                  <>
                    Category filter uses IPFS metadata; markets appear once JSON has loaded and{" "}
                    <span className="font-medium">category</span> matches{" "}
                    <span className="font-medium">{categoryTab}</span>.
                  </>
                )}
                {categoryTab !== "All" && railTab !== "All" && " "}
                {railTab !== "All" && (
                  <>
                    Rail filter uses on-chain <span className="font-medium">marketSettlementRail</span> ({railTab}).
                  </>
                )}
              </p>
            )}

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {isPending && markets.length === 0 ? (
                <div className="col-span-full flex justify-center py-16">
                  <Spinner className="size-8" />
                </div>
              ) : showRailFilterSpinner ? (
                <div className="col-span-full flex justify-center py-16">
                  <Spinner className="size-8" />
                </div>
              ) : visibleMarkets.length === 0 ? (
                <div className="col-span-full flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border py-16">
                  <p className="text-sm text-muted-foreground">No markets match these filters.</p>
                  <Button
                    variant="outline"
                    size="sm"
                    type="button"
                    onClick={() => {
                      setCategoryTab("All");
                      setRailTab("All");
                    }}
                  >
                    Clear filters
                  </Button>
                </div>
              ) : (
                visibleMarkets.map(qId => (
                  <MarketCard
                    key={qId}
                    questionId={qId}
                    registryAddress={registryInfo?.address}
                    registryAbi={registryInfo?.abi}
                    onMetadataLoaded={handleMetaLoaded}
                  />
                ))
              )}
            </div>
          </section>
        </>
      )}
    </>
  );
}
