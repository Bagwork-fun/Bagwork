"use client";

import Link from "next/link";
import { useMemo } from "react";
import { formatUnits } from "viem";
import { type Address } from "viem";
import { useAccount, useReadContract, useReadContracts } from "wagmi";

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Spinner } from "@/components/ui/spinner";
import { computeConditionId, computeOutcomeTokenIds } from "@/lib/market-tokens";
import { railFromUint8, type SettlementRail } from "@/lib/marketRails";
import { useDeployedContractInfo } from "~~/hooks/scaffold-eth";

import { OUTCOME_SHARE_DECIMALS } from "@/lib/market-decimals";

export function PortfolioOnchainPositions() {
  const { address } = useAccount();

  const { data: registryInfo } = useDeployedContractInfo({ contractName: "MarketRegistry" });
  const { data: adapterInfo } = useDeployedContractInfo({ contractName: "AiCTFAdapter" });
  const { data: ctfInfo } = useDeployedContractInfo({ contractName: "ConditionalTokens" });
  const { data: usdcInfo } = useDeployedContractInfo({ contractName: "MockUSDC" });
  const { data: eurcInfo } = useDeployedContractInfo({ contractName: "MockEURC" });

  const { data: allMarkets, isPending: marketsPending } = useReadContract({
    address: registryInfo?.address,
    abi: registryInfo?.abi ?? [],
    functionName: "getAllMarkets",
  }) as { data: readonly `0x${string}`[] | undefined; isPending: boolean };

  const ids = allMarkets ?? [];
  const adapterAddr = adapterInfo?.address as Address | undefined;
  const registryAddr = registryInfo?.address as Address | undefined;
  const registryAbi = registryInfo?.abi ?? [];

  const detailContracts = useMemo(() => {
    if (!registryAddr || ids.length === 0) return [];
    return ids.flatMap(qid => [
      {
        address: registryAddr,
        abi: registryAbi,
        functionName: "getMarket" as const,
        args: [qid] as const,
      },
      {
        address: registryAddr,
        abi: registryAbi,
        functionName: "marketSettlementRail" as const,
        args: [qid] as const,
      },
    ]);
  }, [ids, registryAddr, registryAbi]);

  const { data: detailResults, isPending: detailsPending } = useReadContracts({
    contracts: detailContracts,
    query: {
      enabled: detailContracts.length > 0,
    },
  });

  const ctfAbi = (ctfInfo?.abi ?? []) as readonly object[];
  const ctfAddr = ctfInfo?.address as Address | undefined;

  const balancesConfig = useMemo(() => {
    if (!ctfAddr || !address || !adapterAddr || !detailResults || ids.length === 0) return [];

    type BalContract = {
      abi: typeof ctfAbi;
      address: Address;
      functionName: "balanceOf";
      args: readonly [typeof address, bigint];
      questionId: `0x${string}`;
      side: "Yes" | "No";
      rail: SettlementRail;
    };

    const list: BalContract[] = [];

    for (let i = 0; i < ids.length; i++) {
      const qid = ids[i];
      const marketRes = detailResults[i * 2];
      const railRes = detailResults[i * 2 + 1];
      if (marketRes?.status !== "success" || railRes?.status !== "success") continue;

      const m = marketRes.result as { outcomeCount: bigint; exists: boolean };
      if (!m?.exists || m.outcomeCount == null) continue;

      const rail = railFromUint8(railRes.result as bigint);
      const collateralAddr = (rail === "EURC" ? eurcInfo?.address : usdcInfo?.address) as Address | undefined;

      const conditionId = computeConditionId(adapterAddr, qid, m.outcomeCount);
      const { yesTokenId, noTokenId } = computeOutcomeTokenIds(collateralAddr, conditionId);
      if (!yesTokenId || !noTokenId) continue;

      list.push({
        abi: ctfAbi,
        address: ctfAddr,
        functionName: "balanceOf",
        args: [address, yesTokenId],
        questionId: qid,
        side: "Yes",
        rail,
      });
      list.push({
        abi: ctfAbi,
        address: ctfAddr,
        functionName: "balanceOf",
        args: [address, noTokenId],
        questionId: qid,
        side: "No",
        rail,
      });
    }

    return list;
  }, [ids, adapterAddr, detailResults, ctfAddr, ctfAbi, address, usdcInfo?.address, eurcInfo?.address]);

  const { data: balanceResults, isPending: balsPending } = useReadContracts({
    contracts: balancesConfig.map(({ questionId: _q, side: _s, rail: _r, ...c }) => c),
    query: {
      enabled: balancesConfig.length > 0 && !!address,
    },
  });

  if (!address) {
    return <div className="py-12 text-center text-muted-foreground text-sm">Connect your wallet to view positions</div>;
  }

  if (
    !registryInfo?.address ||
    marketsPending ||
    (detailContracts.length > 0 && detailsPending) ||
    (balancesConfig.length > 0 && balsPending)
  ) {
    return (
      <div className="flex justify-center py-16">
        <Spinner className="size-8" />
      </div>
    );
  }

  const openPositions: {
    questionId: `0x${string}`;
    side: string;
    rail: SettlementRail;
    shares: string;
    href: string;
  }[] = [];

  balanceResults?.forEach((result, i) => {
    const cfg = balancesConfig[i];
    if (!cfg || result.status !== "success") return;
    const v = result.result as bigint | undefined;
    if (!v || v === 0n) return;
    openPositions.push({
      questionId: cfg.questionId,
      side: cfg.side,
      rail: cfg.rail,
      shares: Number(formatUnits(v, OUTCOME_SHARE_DECIMALS)).toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 4,
      }),
      href: `/markets/${cfg.questionId}`,
    });
  });

  function EmptyState({ message }: { message: string }) {
    return <div className="py-12 text-center text-muted-foreground text-sm">{message}</div>;
  }

  return (
    <Tabs defaultValue="positions">
      <TabsList variant="line">
        <TabsTrigger value="positions">Positions ({openPositions.length})</TabsTrigger>
        <TabsTrigger value="markets">Tracked markets ({ids.length})</TabsTrigger>
      </TabsList>
      <TabsContent value="positions" className="pt-2">
        {openPositions.length === 0 ? (
          <EmptyState message="No ERC-1155 outcome shares detected for tracked markets." />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Market</TableHead>
                <TableHead>Rail</TableHead>
                <TableHead>Outcome</TableHead>
                <TableHead className="text-right">Shares</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {openPositions.map(p => (
                <TableRow key={`${p.questionId}-${p.side}-${p.rail}`} className="h-14">
                  <TableCell>
                    <Link href={p.href} className="font-mono text-xs hover:underline line-clamp-1 max-w-[18rem]" title={p.questionId}>
                      {p.questionId.slice(0, 10)}…{p.questionId.slice(-6)}
                    </Link>
                  </TableCell>
                  <TableCell className="text-xs font-medium">{p.rail}</TableCell>
                  <TableCell>
                    <span
                      className={
                        p.side === "Yes"
                          ? "text-teal-600 dark:text-teal-400 font-medium text-sm"
                          : "text-red-600/80 dark:text-red-400 font-medium text-sm"
                      }
                    >
                      {p.side}
                    </span>
                  </TableCell>
                  <TableCell className="text-right text-sm tabular-nums">{p.shares}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </TabsContent>
      <TabsContent value="markets" className="pt-2">
        {ids.length === 0 ? (
          <EmptyState message="No markets deployed on this registry." />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Question ID</TableHead>
                <TableHead className="text-right">Open</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {ids.map(qid => (
                <TableRow key={qid}>
                  <TableCell>
                    <Link href={`/markets/${qid}`} className="font-mono text-xs hover:underline">
                      {qid}
                    </Link>
                  </TableCell>
                  <TableCell className="text-right text-sm text-muted-foreground">Market page</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </TabsContent>
    </Tabs>
  );
}
