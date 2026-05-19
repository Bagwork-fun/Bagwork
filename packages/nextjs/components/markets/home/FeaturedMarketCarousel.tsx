"use client";

import { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronLeftIcon, ChevronRightIcon } from "@heroicons/react/24/outline";

import type { Abi } from "viem";

import { cn } from "@/lib/utils";
import { usePrefetchMarketMetadata } from "~~/hooks/markets/useMarketMetadata";
import { FeaturedMarketCard } from "~~/components/markets/home/FeaturedMarketCard";

const AUTO_ADVANCE_MS = 5000;

const slideVariants = {
  enter: { opacity: 0 },
  center: { opacity: 1 },
  exit: { opacity: 0 },
};

interface MetaLite {
  category?: string;
  title?: string;
}

type Props = {
  questionIds: `0x${string}`[];
  registryAddress?: `0x${string}`;
  registryAbi?: Abi;
  onMetadataLoaded?: (questionId: `0x${string}`, meta: MetaLite) => void;
  onIndexChange?: (index: number) => void;
};

function slideLabel(title: string | undefined, questionId: `0x${string}`): string {
  if (title?.trim()) {
    const t = title.trim();
    return t.length > 24 ? `${t.slice(0, 22)}…` : t;
  }
  return `Market ${questionId.slice(2, 8)}…`;
}

export function FeaturedMarketCarousel({
  questionIds,
  registryAddress,
  registryAbi,
  onMetadataLoaded,
  onIndexChange,
}: Props) {
  const [idx, setIdx] = useState(0);
  const [paused, setPaused] = useState(false);
  const [titles, setTitles] = useState<Record<string, string>>({});
  const prefetchMetadata = usePrefetchMarketMetadata();

  const count = questionIds.length;

  useEffect(() => {
    setIdx(i => (count === 0 ? 0 : Math.min(i, count - 1)));
  }, [count, questionIds]);

  useEffect(() => {
    onIndexChange?.(idx);
  }, [idx, onIndexChange]);

  const go = useCallback(
    (dir: -1 | 1) => {
      if (count <= 1) return;
      setIdx(i => (i + dir + count) % count);
    },
    [count],
  );

  useEffect(() => {
    if (paused || count <= 1) return;
    const t = setInterval(() => setIdx(i => (i + 1) % count), AUTO_ADVANCE_MS);
    return () => clearInterval(t);
  }, [paused, count]);

  const currentId = questionIds[idx];
  const prevId = count > 1 ? questionIds[(idx - 1 + count) % count] : undefined;
  const nextId = count > 1 ? questionIds[(idx + 1) % count] : undefined;

  useEffect(() => {
    if (count <= 1) return;
    const neighbors = [
      questionIds[(idx + 1) % count],
      questionIds[(idx - 1 + count) % count],
    ];
    for (const id of neighbors) {
      void prefetchMetadata(id);
    }
  }, [idx, count, questionIds, prefetchMetadata]);

  const handleMeta = useCallback(
    (questionId: `0x${string}`, meta: { category?: string; settlementAsset?: string; title?: string }) => {
      if (meta.title) {
        setTitles(prev => ({ ...prev, [questionId]: meta.title! }));
      }
      onMetadataLoaded?.(questionId, { category: meta.category, title: meta.title });
    },
    [onMetadataLoaded],
  );

  const showControls = count > 1;

  if (!currentId) return null;

  return (
    <div onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}>
      <div className="relative min-h-[480px]">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={currentId}
            variants={slideVariants}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{ duration: 0.35, ease: "easeInOut" }}
          >
            <FeaturedMarketCard
              questionId={currentId}
              registryAddress={registryAddress}
              registryAbi={registryAbi}
              onMetadataLoaded={handleMeta}
            />
          </motion.div>
        </AnimatePresence>
      </div>

      {showControls && prevId && nextId ? (
        <div className="mt-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-1.5" role="tablist" aria-label="Featured markets">
            {questionIds.map((id, i) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={i === idx}
                aria-label={`Go to market ${i + 1}`}
                onClick={() => setIdx(i)}
                className={cn(
                  "h-1 rounded-full transition-all",
                  i === idx
                    ? "w-8 bg-[#8b95a1] dark:bg-muted-foreground"
                    : "w-4 bg-[#cfd4da] hover:bg-[#a8b0b8] dark:bg-muted dark:hover:bg-muted-foreground/80",
                )}
              />
            ))}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => go(-1)}
              className="flex max-w-[min(100%,200px)] items-center gap-1 rounded-full border border-[#e8e8ee] bg-white px-3 py-2 text-sm text-[#0f1419] transition hover:bg-gray-50 dark:border-border dark:bg-card dark:text-foreground dark:hover:bg-muted sm:px-4"
            >
              <ChevronLeftIcon className="size-4 shrink-0" aria-hidden />
              <span className="truncate">{slideLabel(titles[prevId], prevId)}</span>
            </button>
            <button
              type="button"
              onClick={() => go(1)}
              className="flex max-w-[min(100%,200px)] items-center gap-1 rounded-full border border-[#e8e8ee] bg-white px-3 py-2 text-sm text-[#0f1419] transition hover:bg-gray-50 dark:border-border dark:bg-card dark:text-foreground dark:hover:bg-muted sm:px-4"
            >
              <span className="truncate">{slideLabel(titles[nextId], nextId)}</span>
              <ChevronRightIcon className="size-4 shrink-0" aria-hidden />
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
