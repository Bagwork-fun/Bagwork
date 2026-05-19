"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Command } from "cmdk";
import { Dialog as DialogPrimitive } from "radix-ui";
import { useReadContract } from "wagmi";
import { HugeiconsIcon } from "@hugeicons/react";
import { Search01Icon } from "@hugeicons/core-free-icons";
import { filterVisibleMarkets } from "@/lib/market-blocklist";
import { useDeployedContractInfo } from "~~/hooks/scaffold-eth";

export function SearchMarketsCommand() {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const router = useRouter();

  const { data: registryInfo } = useDeployedContractInfo({ contractName: "MarketRegistry" });

  const { data: allMarkets } = useReadContract({
    address: registryInfo?.address,
    abi: registryInfo?.abi ?? [],
    functionName: "getAllMarkets",
  }) as { data: readonly `0x${string}`[] | undefined };

  const ids = React.useMemo(() => filterVisibleMarkets([...(allMarkets ?? [])]), [allMarkets]);

  React.useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen(o => !o);
      }
    };
    document.addEventListener("keydown", down);
    return () => document.removeEventListener("keydown", down);
  }, []);

  React.useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return ids.slice(0, 20);
    return ids.filter(id => id.toLowerCase().includes(q)).slice(0, 30);
  }, [ids, query]);

  function handleSelect(id: string) {
    setOpen(false);
    router.push(`/markets/${id as `0x${string}`}`);
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="relative w-full max-w-lg flex items-center gap-2 rounded-full border bg-muted/50 px-3 h-10 text-sm text-muted-foreground hover:bg-muted transition-colors cursor-pointer"
      >
        <HugeiconsIcon icon={Search01Icon} className="size-4 shrink-0" />
        <span className="flex-1 text-left">Search markets</span>
        <kbd className="hidden sm:inline-flex items-center gap-0.5 rounded border bg-background px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
          <span className="text-xs">⌘</span>K
        </kbd>
      </button>

      <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/20 supports-backdrop-filter:backdrop-blur-xs data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0" />
          <DialogPrimitive.Content className="fixed top-[15%] left-1/2 z-50 w-full max-w-xl -translate-x-1/2 rounded-xl bg-background ring-1 ring-border shadow-2xl overflow-hidden data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95">
            <Command shouldFilter={false} className="flex flex-col">
              <div className="flex items-center gap-3 border-b px-4">
                <HugeiconsIcon icon={Search01Icon} className="size-4 shrink-0 text-muted-foreground" />
                <Command.Input
                  value={query}
                  onValueChange={setQuery}
                  placeholder="Search by question ID…"
                  className="flex-1 h-14 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                />
              </div>
              <Command.List className="min-h-[120px] max-h-[420px] overflow-y-auto p-2">
                {filtered.length === 0 && ids.length === 0 && (
                  <div className="px-3 py-8 text-center text-sm text-muted-foreground">No markets on-chain yet.</div>
                )}
                {filtered.length === 0 && ids.length > 0 && query.trim() && (
                  <Command.Empty className="px-3 py-8 text-center text-sm text-muted-foreground">No matches.</Command.Empty>
                )}
                {filtered.map(qid => (
                  <Command.Item
                    key={qid}
                    value={qid}
                    onSelect={() => handleSelect(qid)}
                    className="flex items-center gap-3 rounded-lg px-3 py-3 cursor-pointer text-sm data-[selected=true]:bg-muted/60 transition-colors"
                  >
                    <div className="size-9 rounded-lg bg-muted shrink-0 flex items-center justify-center text-[10px] font-mono text-muted-foreground">
                      {qid.slice(2, 4)}
                    </div>
                    <span className="flex-1 font-mono text-xs truncate">{qid}</span>
                  </Command.Item>
                ))}
              </Command.List>
            </Command>
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>
    </>
  );
}
