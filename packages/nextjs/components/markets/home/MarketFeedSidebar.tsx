"use client";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { MarketFeedRow } from "~~/components/markets/home/MarketFeedRow";

type Props = {
  sidebarQuestionIds: `0x${string}`[];
  activeHeroId?: `0x${string}`;
  onExploreAll: () => void;
};

export function MarketFeedSidebar({ sidebarQuestionIds, activeHeroId, onExploreAll }: Props) {
  return (
    <div className="flex flex-col gap-4">
      <Card className="rounded-xl border bg-card p-4 shadow-sm ring-1 ring-border/60">
        <h3 className="text-sm font-semibold tracking-tight text-foreground">Breaking</h3>
        <p className="mt-0.5 text-xs text-muted-foreground">Active markets by odds</p>
        <div className="mt-3 flex flex-col divide-y divide-border/60 border-t border-border/60 pt-2">
          {sidebarQuestionIds.length === 0 ? (
            <p className="py-4 text-sm text-muted-foreground">More markets will appear here.</p>
          ) : (
            sidebarQuestionIds.map((q, i) => (
              <MarketFeedRow
                key={q}
                questionId={q}
                index={i + 1}
                isActive={activeHeroId != null && q === activeHeroId}
              />
            ))
          )}
        </div>
        <Button variant="secondary" className="mt-4 w-full rounded-full" type="button" onClick={onExploreAll}>
          Explore all
        </Button>
      </Card>
    </div>
  );
}
