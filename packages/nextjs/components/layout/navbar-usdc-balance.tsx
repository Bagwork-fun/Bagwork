"use client";

import { formatUnits } from "viem";
import Link from "next/link";
import { useAccount, useReadContract } from "wagmi";

import { Spinner } from "@/components/ui/spinner";
import { Button } from "@/components/ui/button";
import { useDeployedContractInfo } from "~~/hooks/scaffold-eth";

function fmt6(raw: bigint | undefined, pending: boolean) {
  if (pending && raw === undefined) return <Spinner className="size-3 inline" />;
  const n =
    raw !== undefined
      ? Number(formatUnits(raw, 6)).toLocaleString(undefined, {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })
      : "0.00";
  return <span className="font-medium">{n}</span>;
}

/** Dual stable balances (MockUSDC / MockEURC or Sepolia Circle test tokens deployed under these names). */
export function NavbarStableBalances() {
  const { address } = useAccount();
  const { data: usdcInfo } = useDeployedContractInfo({ contractName: "MockUSDC" });
  const { data: eurcInfo } = useDeployedContractInfo({ contractName: "MockEURC" });

  const zero = "0x0000000000000000000000000000000000000000" as const;

  const { data: usdcBal, isPending: usdcPending } = useReadContract({
    address: usdcInfo?.address,
    abi: usdcInfo?.abi ?? [],
    functionName: "balanceOf",
    args: [address ?? zero],
    query: { enabled: !!address && !!usdcInfo },
  }) as { data: bigint | undefined; isPending: boolean };

  const { data: eurcBal, isPending: eurcPending } = useReadContract({
    address: eurcInfo?.address,
    abi: eurcInfo?.abi ?? [],
    functionName: "balanceOf",
    args: [address ?? zero],
    query: { enabled: !!address && !!eurcInfo },
  }) as { data: bigint | undefined; isPending: boolean };

  if (!address) return null;

  return (
    <div className="hidden xl:flex items-center gap-2 text-sm mr-1 tabular-nums flex-wrap justify-end">
      <span className="text-xs text-muted-foreground whitespace-nowrap">Balances:</span>
      <span className="rounded-full bg-muted/80 px-2 py-0.5 text-xs">
        USDC {fmt6(usdcBal, usdcPending)}
      </span>
      <span className="rounded-full bg-muted/80 px-2 py-0.5 text-xs">
        EURC {fmt6(eurcBal, eurcPending)}
      </span>
      <Button variant="ghost" size="xs" className="h-7 px-2 text-xs" asChild>
        <Link href="/deposit">Deposit</Link>
      </Button>
    </div>
  );
}

/** @deprecated Use NavbarStableBalances — alias kept for incremental refactors */
export const NavbarUsdcBalance = NavbarStableBalances;
