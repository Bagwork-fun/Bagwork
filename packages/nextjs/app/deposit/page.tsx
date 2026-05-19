"use client";

/**
 * Circle MCP notes (research tools; not runtime dependencies):
 * - search_circle_documentation → Bridge Kit supported chains + CCTP v2 quickstarts.
 * - get_circle_product_summary(cctp) → use Bridge Kit for USDC bridging; Gateway for unified multi-chain balance.
 * - get_coding_resource_details(bridge_@circle-fin/bridge-kit) → `kit.bridge()` runs approve → burn → attestation → mint.
 *
 * EURC is not interchangeable with USDC on CCTP; acquire EURC via Circle testnet faucets or same-chain swaps where
 * liquidity exists — do not imply CCTP mints EURC on the destination.
 */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { EIP1193Provider } from "viem";
import { useAccount, useChainId, useSwitchChain } from "wagmi";
import { BridgeKit, type BridgeChainIdentifier } from "@circle-fin/bridge-kit";
import { createViemAdapterFromProvider } from "@circle-fin/adapter-viem-v2";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  BRIDGE_SOURCE_OPTIONS,
  destinationBridgeKitChain,
  isLocalhostTarget,
  type BridgeSourceOption,
} from "@/lib/bridgeKitChains";
import scaffoldConfig from "~~/scaffold.config";

const bridgeKit = new BridgeKit();

export default function DepositPage() {
  const { address, connector, isConnected } = useAccount();
  const chainId = useChainId();
  const { switchChainAsync } = useSwitchChain();

  const destinationChain = destinationBridgeKitChain();
  const [amount, setAmount] = useState("10");
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const sourceOptions = useMemo(() => {
    const filtered = BRIDGE_SOURCE_OPTIONS.filter(o => o.bridgeKitChain !== destinationChain);
    return filtered.length > 0 ? filtered : BRIDGE_SOURCE_OPTIONS;
  }, [destinationChain]);

  const [source, setSource] = useState<BridgeSourceOption>(BRIDGE_SOURCE_OPTIONS[0]);

  useEffect(() => {
    setSource(prev => sourceOptions.find(o => o.id === prev.id) ?? sourceOptions[0] ?? BRIDGE_SOURCE_OPTIONS[0]);
  }, [sourceOptions]);

  const targetNetworkName = scaffoldConfig.targetNetworks[0]?.name ?? "target network";

  const handleBridge = async () => {
    if (!isConnected || !address || !connector || !destinationChain) {
      setStatus("Connect a wallet and ensure the app target network is supported for Bridge Kit.");
      return;
    }
    if (!amount || Number(amount) <= 0) {
      setStatus("Enter a positive USDC amount.");
      return;
    }

    setBusy(true);
    setStatus("Preparing bridge…");
    try {
      if (chainId !== source.chainId) {
        await switchChainAsync({ chainId: source.chainId });
      }

      const provider = (await connector.getProvider()) as EIP1193Provider;
      const adapter = await createViemAdapterFromProvider({ provider });

      const result = await bridgeKit.bridge({
        from: { adapter, chain: source.bridgeKitChain as BridgeChainIdentifier },
        to: { adapter, chain: destinationChain as BridgeChainIdentifier },
        amount,
        config: {
          transferSpeed: "FAST",
        },
      });

      const lastMint = result.steps?.filter(s => s.name === "mint").pop();
      setStatus(
        lastMint?.state === "success" && "txHash" in lastMint && lastMint.txHash
          ? `✅ Bridged ${result.amount} USDC. Mint tx: ${lastMint.txHash}`
          : `✅ Bridge finished: ${result.state}`,
      );
    } catch (e) {
      setStatus(`❌ ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-muted/30">
      <div className="max-w-lg mx-auto px-6 py-10 space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Deposit USDC (CCTP)</h1>
          <p className="text-muted-foreground text-sm mt-2 leading-relaxed">
            Move native USDC into <span className="font-medium text-foreground">{targetNetworkName}</span> using Circle
            Bridge Kit. Your connected address signs burn on the source chain and mint on the destination.
          </p>
        </div>

        {isLocalhostTarget() && (
          <Card className="rounded-2xl p-4 text-sm border-amber-500/40 bg-amber-500/10">
            Localhost is not a CCTP domain. Switch <code className="text-xs bg-muted px-1 rounded">targetNetworks</code>{" "}
            to a testnet (e.g. Sepolia) to run a real bridge, or use mock mint on Liquidity.
          </Card>
        )}

        {!destinationChain && (
          <Card className="rounded-2xl p-4 text-sm border-destructive/40 bg-destructive/10 text-destructive">
            This app&apos;s chain ID is not mapped to a Bridge Kit name. Add it in{" "}
            <code className="text-xs bg-background/50 px-1 rounded">lib/bridgeKitChains.ts</code>.
          </Card>
        )}

        <Card className="rounded-2xl p-5 space-y-4 ring-1 ring-border/70">
          <div>
            <label className="text-sm font-medium">From (source chain)</label>
            <select
              className="mt-1 flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={source.id}
              onChange={e => {
                const next = sourceOptions.find(o => o.id === e.target.value);
                if (next) setSource(next);
              }}
            >
              {sourceOptions.map(o => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-sm font-medium">Amount (USDC)</label>
            <input
              type="text"
              inputMode="decimal"
              className="mt-1 flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={amount}
              onChange={e => setAmount(e.target.value)}
            />
          </div>

          <p className="text-xs text-muted-foreground leading-relaxed">
            Destination: <span className="font-mono">{destinationChain ?? "—"}</span>. You need USDC + gas on the source
            chain. See{" "}
            <a className="underline" href="https://developers.circle.com/bridge-kit" target="_blank" rel="noreferrer">
              Bridge Kit docs
            </a>
            .
          </p>

          <Button className="w-full" disabled={busy || !destinationChain || !isConnected} type="button" onClick={handleBridge}>
            {busy ? "Bridging…" : "Bridge USDC"}
          </Button>

          {!isConnected && (
            <p className="text-xs text-muted-foreground text-center">Connect your wallet in the header to continue.</p>
          )}

          {status && (
            <p className={`text-xs whitespace-pre-wrap ${status.startsWith("❌") ? "text-destructive" : "text-emerald-700 dark:text-emerald-400"}`}>
              {status}
            </p>
          )}
        </Card>

        <p className="text-xs text-muted-foreground text-center">
          <Button variant="link" className="h-auto p-0 text-xs" asChild>
            <Link href="/">← Back to markets</Link>
          </Button>
        </p>
      </div>
    </div>
  );
}
