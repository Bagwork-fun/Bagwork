"use client";

import { useReadContract, useWatchContractEvent } from "wagmi";

import { CreateMarketModal } from "~~/components/markets/CreateMarketModal";
import { useDeployedContractInfo } from "~~/hooks/scaffold-eth";
import { useGlobalState } from "~~/services/store/store";

/** Renders the create-market dialog when opened from the footer or homepage (global store). */
export function CreateMarketModalHost() {
  const open = useGlobalState(s => s.createMarketModalOpen);
  const setOpen = useGlobalState(s => s.setCreateMarketModalOpen);

  const { data: registryInfo } = useDeployedContractInfo({ contractName: "MarketRegistry" });

  const { refetch } = useReadContract({
    address: registryInfo?.address,
    abi: registryInfo?.abi ?? [],
    functionName: "getAllMarkets",
  }) as { refetch: () => void };

  useWatchContractEvent({
    address: registryInfo?.address,
    abi: registryInfo?.abi ?? [],
    eventName: "MarketCreated",
    onLogs: () => refetch(),
  });

  if (!open) return null;

  return (
    <CreateMarketModal
      onClose={() => setOpen(false)}
      onCreated={() => {
        setOpen(false);
        void refetch();
      }}
    />
  );
}
