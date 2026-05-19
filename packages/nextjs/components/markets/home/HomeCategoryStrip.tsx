"use client";

import { ArrowTrendingUpIcon } from "@heroicons/react/24/outline";
import { cn } from "@/lib/utils";
import { MARKET_CATEGORY_TABS, type MarketCategoryTab } from "@/lib/marketRails";

type Props = {
  value: MarketCategoryTab;
  onValueChange: (tab: MarketCategoryTab) => void;
};

export function HomeCategoryStrip({ value, onValueChange }: Props) {
  return (
    <div className="-mx-6 px-6 mb-6 border-b border-border/80 bg-muted/20">
      <div className="flex items-center gap-1 overflow-x-auto py-3">
        {MARKET_CATEGORY_TABS.map((tab, i) => {
          const active = value === tab;
          return (
            <button
              key={tab}
              type="button"
              onClick={() => onValueChange(tab)}
              className={cn(
                "flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1.5 text-sm font-medium transition-colors",
                active
                  ? "bg-background text-foreground shadow-sm ring-1 ring-border"
                  : "text-muted-foreground hover:bg-background/80 hover:text-foreground"
              )}
            >
              {i === 0 ? <ArrowTrendingUpIcon className="size-4 opacity-70" aria-hidden /> : null}
              {tab === "All" ? "Trending" : tab}
            </button>
          );
        })}
      </div>
    </div>
  );
}
