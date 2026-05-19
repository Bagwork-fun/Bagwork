"use client";

import Link from "next/link";
import { hardhat } from "viem/chains";
import { BugAntIcon, CurrencyDollarIcon, MagnifyingGlassIcon } from "@heroicons/react/24/outline";
import { Button } from "@/components/ui/button";
import { Faucet } from "~~/components/scaffold-eth";
import { useTargetNetwork } from "~~/hooks/scaffold-eth/useTargetNetwork";
import { useGlobalState } from "~~/services/store/store";

export const Footer = () => {
  const setCreateMarketModalOpen = useGlobalState(s => s.setCreateMarketModalOpen);
  const nativeCurrencyPrice = useGlobalState(state => state.nativeCurrency.price);
  const { targetNetwork } = useTargetNetwork();
  const isLocalNetwork = targetNetwork.id === hardhat.id;

  return (
    <footer className="mt-auto border-t bg-background pb-28 lg:pb-8">
      <div className="max-w-[90rem] mx-auto px-6 py-6 text-sm text-muted-foreground">
        <div className="flex flex-wrap gap-x-6 gap-y-3 justify-center items-center">
          <span className="text-muted-foreground">© {new Date().getFullYear()} Bagwork</span>
          <span className="opacity-40">·</span>
          <a href="https://t.me/joinchat/KByvmRe5wkR-8F_zz6AjpA" target="_blank" rel="noreferrer" className="underline-offset-4 hover:underline hover:text-foreground">
            Support
          </a>
          <span className="opacity-40">·</span>
          <Button variant="ghost" size="sm" className="h-auto py-1 px-2 text-muted-foreground hover:text-foreground" type="button" onClick={() => setCreateMarketModalOpen(true)}>
            Create market
          </Button>
        </div>

        {(isLocalNetwork || nativeCurrencyPrice > 0) && (
          <p className="text-center text-xs mt-4 text-muted-foreground/90">
            Dev tools (local): faucet, block explorer, and contract debug stay here — away from the main navbar.
          </p>
        )}
      </div>

      <div className="fixed z-40 bottom-0 left-0 right-0 pointer-events-none p-4">
        <div className="max-w-[90rem] mx-auto flex flex-col md:flex-row justify-between gap-3 items-stretch md:items-center pointer-events-auto">
          <div className="flex flex-wrap gap-2">
            {nativeCurrencyPrice > 0 && (
              <Button variant="secondary" size="sm" disabled className="cursor-default shrink-0">
                <CurrencyDollarIcon className="size-4" />
                {nativeCurrencyPrice.toFixed(2)}
              </Button>
            )}
            {isLocalNetwork && (
              <>
                <Faucet />
                <Button variant="secondary" size="sm" className="shrink-0" asChild>
                  <Link href="/blockexplorer" className="gap-2">
                    <MagnifyingGlassIcon className="size-4" />
                    Block explorer
                  </Link>
                </Button>
                <Button variant="outline" size="sm" className="shrink-0" asChild>
                  <Link href="/debug">
                    <BugAntIcon className="size-4" />
                    Debug contracts
                  </Link>
                </Button>
              </>
            )}
          </div>
        </div>
      </div>
    </footer>
  );
};
