"use client";

import { useState } from "react";
import { createWalletClient, http, parseEther } from "viem";
import { hardhat } from "viem/chains";
import { useAccount } from "wagmi";
import { BanknotesIcon } from "@heroicons/react/24/outline";
import { useTransactor } from "~~/hooks/scaffold-eth";
import { useWatchBalance } from "~~/hooks/scaffold-eth/useWatchBalance";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

const NUM_OF_ETH = "1";
const FAUCET_ADDRESS = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";

const localWalletClient = createWalletClient({
  chain: hardhat,
  transport: http(),
});

/** Compact faucet shortcut (grab ETH on local chain). */
export const FaucetButton = () => {
  const { address, chain: ConnectedChain } = useAccount();
  const { data: balance } = useWatchBalance({ address });
  const [loading, setLoading] = useState(false);

  const faucetTxn = useTransactor(localWalletClient);

  const sendETH = async () => {
    if (!address) return;
    try {
      setLoading(true);
      await faucetTxn({
        account: FAUCET_ADDRESS,
        to: address,
        value: parseEther(NUM_OF_ETH),
      });
      setLoading(false);
    } catch (error) {
      console.error("⚡️ ~ file: FaucetButton.tsx:sendETH ~ error", error);
      setLoading(false);
    }
  };

  if (ConnectedChain?.id !== hardhat.id) {
    return null;
  }

  const isBalanceZero = balance && balance.value === 0n;

  return (
    <div title={isBalanceZero ? "Grab funds from faucet" : undefined} className="ml-1">
      <Button size="sm" variant="secondary" type="button" className="h-8 w-8 p-0 rounded-full" onClick={sendETH} disabled={loading}>
        {!loading ? <BanknotesIcon className="size-4" /> : <Spinner className="size-4" />}
      </Button>
    </div>
  );
};
