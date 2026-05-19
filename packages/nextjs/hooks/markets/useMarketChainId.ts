"use client";

import { useTargetNetwork } from "~~/hooks/scaffold-eth";
import type { AllowedChainIds } from "~~/utils/scaffold-eth";

/** Chain for market registry logs — scaffold target network, not the connected wallet chain. */
export function useMarketChainId(): AllowedChainIds {
  const { targetNetwork } = useTargetNetwork();
  return targetNetwork.id;
}
