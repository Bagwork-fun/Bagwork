"use client";

import { Address, formatEther } from "viem";
import { Button } from "@/components/ui/button";
import { useDisplayUsdMode } from "~~/hooks/scaffold-eth/useDisplayUsdMode";
import { useTargetNetwork } from "~~/hooks/scaffold-eth/useTargetNetwork";
import { useWatchBalance } from "~~/hooks/scaffold-eth/useWatchBalance";
import { useGlobalState } from "~~/services/store/store";

type BalanceProps = {
  address?: Address;
  className?: string;
  usdMode?: boolean;
};

/**
 * Display (ETH & USD) balance of an ETH address.
 */
export const Balance = ({ address, className = "", usdMode }: BalanceProps) => {
  const { targetNetwork } = useTargetNetwork();
  const nativeCurrencyPrice = useGlobalState(state => state.nativeCurrency.price);
  const isNativeCurrencyPriceFetching = useGlobalState(state => state.nativeCurrency.isFetching);

  const {
    data: balance,
    isError,
    isLoading,
  } = useWatchBalance({
    address,
  });

  const { displayUsdMode, toggleDisplayUsdMode } = useDisplayUsdMode({ defaultUsdMode: usdMode });

  if (!address || isLoading || balance === null || (isNativeCurrencyPriceFetching && nativeCurrencyPrice === 0)) {
    return (
      <div className="animate-pulse flex space-x-4">
        <div className="rounded-md bg-muted h-6 w-6 shrink-0" />
        <div className="flex items-center">
          <div className="h-2 w-28 bg-muted rounded-sm" />
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="border border-destructive/40 rounded-md px-2 flex flex-col items-center max-w-fit cursor-default">
        <div className="text-destructive text-sm py-1">Error</div>
      </div>
    );
  }

  const formattedBalance = balance ? Number(formatEther(balance.value)) : 0;

  return (
    <Button
      variant="ghost"
      size="sm"
      className={`flex flex-col h-auto min-h-0 py-1 px-2 font-normal items-center hover:bg-transparent ${className}`}
      onClick={toggleDisplayUsdMode}
      type="button"
    >
      <div className="w-full flex items-center justify-center">
        {displayUsdMode ? (
          <>
            <span className="text-[0.8em] font-bold mr-1">$</span>
            <span>{(formattedBalance * nativeCurrencyPrice).toFixed(2)}</span>
          </>
        ) : (
          <>
            <span>{formattedBalance.toFixed(4)}</span>
            <span className="text-[0.8em] font-bold ml-1">{targetNetwork.nativeCurrency.symbol}</span>
          </>
        )}
      </div>
    </Button>
  );
};
