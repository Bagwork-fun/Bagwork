"use client";

import { useEffect, useState } from "react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { Address as AddressType, createWalletClient, http, parseEther } from "viem";
import { hardhat } from "viem/chains";
import { useAccount } from "wagmi";
import { BanknotesIcon } from "@heroicons/react/24/outline";
import { Address, AddressInput, Balance, EtherInput } from "~~/components/scaffold-eth";
import { useTransactor } from "~~/hooks/scaffold-eth";
import { notification } from "~~/utils/scaffold-eth";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

const FAUCET_ACCOUNT_INDEX = 0;

const localWalletClient = createWalletClient({
  chain: hardhat,
  transport: http(),
});

/** Local-chain faucet modal: send ETH from the first prefunded Hardhat account. */
export const Faucet = () => {
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [inputAddress, setInputAddress] = useState<AddressType>();
  const [faucetAddress, setFaucetAddress] = useState<AddressType>();
  const [sendValue, setSendValue] = useState("");

  const { chain: ConnectedChain } = useAccount();

  const faucetTxn = useTransactor(localWalletClient);

  useEffect(() => {
    const getFaucetAddress = async () => {
      try {
        const accounts = await localWalletClient.getAddresses();
        setFaucetAddress(accounts[FAUCET_ACCOUNT_INDEX]);
      } catch (error) {
        notification.error(
          <>
            <p className="font-bold mt-0 mb-1">Cannot connect to local provider</p>
            <p className="m-0">
              - Did you forget to run <code className="rounded bg-muted px-1 py-0.5 text-xs">yarn chain</code> ?
            </p>
            <p className="mt-1">
              - Or update <code className="rounded bg-muted px-1 py-0.5 text-xs">targetNetwork</code> in{" "}
              <code className="rounded bg-muted px-1 py-0.5 text-xs">scaffold.config.ts</code>
            </p>
          </>,
        );
        console.error("⚡️ ~ file: Faucet.tsx:getFaucetAddress ~ error", error);
      }
    };
    void getFaucetAddress();
  }, []);

  const sendETH = async () => {
    if (!faucetAddress || !inputAddress) return;
    try {
      setLoading(true);
      await faucetTxn({
        to: inputAddress,
        value: parseEther(sendValue as `${number}`),
        account: faucetAddress,
      });
      setOpen(false);
      setInputAddress(undefined);
      setSendValue("");
      setLoading(false);
    } catch (error) {
      console.error("⚡️ ~ file: Faucet.tsx:sendETH ~ error", error);
      setLoading(false);
    }
  };

  if (ConnectedChain?.id !== hardhat.id) {
    return null;
  }

  return (
    <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
      <Button size="sm" variant="secondary" type="button" className="shrink-0 gap-2" onClick={() => setOpen(true)}>
        <BanknotesIcon className="size-4" />
        Faucet
      </Button>

      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/40 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0" />
        <DialogPrimitive.Content className="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl border bg-card p-6 text-card-foreground shadow-xl ring-1 ring-border outline-none">
          <div className="flex items-start justify-between gap-4 mb-4">
            <h3 className="text-lg font-semibold">Local faucet</h3>
            <Button variant="ghost" size="icon-sm" type="button" aria-label="Close" onClick={() => setOpen(false)}>
              ✕
            </Button>
          </div>

          <div className="space-y-4 text-sm">
            <div className="flex flex-wrap gap-6">
              <div className="min-w-0">
                <span className="font-medium text-muted-foreground block text-xs uppercase tracking-wide">From</span>
                <Address address={faucetAddress} onlyEnsOrAddress />
              </div>
              <div>
                <span className="font-medium text-muted-foreground block text-xs uppercase tracking-wide">Available</span>
                <Balance address={faucetAddress} />
              </div>
            </div>

            <AddressInput
              placeholder="Destination Address"
              value={inputAddress ?? ""}
              onChange={value => setInputAddress(value as AddressType)}
            />
            <EtherInput placeholder="Amount to send" value={sendValue} onChange={value => setSendValue(value)} />
            <Button type="button" className="w-full gap-2" onClick={sendETH} disabled={loading}>
              {loading ? <Spinner className="size-4" /> : <BanknotesIcon className="size-5" />}
              Send ETH
            </Button>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
};
