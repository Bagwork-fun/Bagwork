"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { formatUnits, parseUnits, parseAbi } from "viem";
import { useAccount, useChainId, useReadContract, usePublicClient, useBlockNumber } from "wagmi";
import {
  useDeployedContractInfo,
  useScaffoldWriteContract,
  useScaffoldEventHistory,
  useScaffoldReadContract,
} from "~~/hooks/scaffold-eth";
import { railFromUint8, type SettlementRail } from "@/lib/marketRails";
import { fetchIpfsJson, marketRegistryLogsFromBlock, parseMarketCreatedIpfsCid } from "@/lib/market-ipfs";
import {
  buildRedeemIndexSets,
  CTF_PARENT_COLLECTION_ZERO,
  estimateOutcomeRedeemPayout,
  totalRedeemableCollateral,
} from "@/lib/ctf-redeem";
import { YourPositionCard } from "@/components/markets/your-position-card";
import { computeConditionId, computeOutcomeTokenIds } from "@/lib/market-tokens";
import { isHiddenMarket } from "@/lib/market-blocklist";
import { pickEarliestLog, volumeFromBlock } from "@/lib/market-detail-utils";
import { getBlockExplorerTxLink } from "~~/utils/scaffold-eth";
import { MarketChart } from "~~/components/markets/MarketChart";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  ArrowDown01Icon,
  Bookmark01Icon,
  Link01Icon,
  SourceCodeIcon,
  InformationCircleIcon,
} from "@hugeicons/core-free-icons";

interface MarketMetadata {
  title: string;
  description: string;
  outcomes: string[];
  resolutionTime: number;
  category: string;
  imageUrl?: string;
  settlementAsset?: string;
  /** Optional: include in IPFS JSON after resolution if you publish narrative off-chain */
  resolutionReasoning?: string;
  aiResolutionSummary?: string;
}

interface PageProps {
  params: Promise<{ questionId: `0x${string}` }>;
}

function formatMarketDateTime(ms: number): string {
  return new Date(ms).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Matches AiCTFAdapter.MarketStatus enum indices */
const ADAPTER_STATUS_LABELS = ["Uninitialized", "Active", "Proposed", "Resolved"] as const;

const TRADE_EVENTS_ABI = parseAbi([
  "event TokensBought(bytes32 indexed conditionId, address indexed buyer, uint256 outcome, uint256 tokenAmount, uint256 usdcPaid)",
  "event TokensSold(bytes32 indexed conditionId, address indexed seller, uint256 outcome, uint256 tokenAmount, uint256 usdcReceived)",
]);

export default function MarketDetailPage({ params }: PageProps) {
  const { questionId } = React.use(params);
  if (isHiddenMarket(questionId)) notFound();

  const chainId = useChainId();
  const publicClient = usePublicClient({ chainId });
  const { data: latestBlock } = useBlockNumber({ chainId, watch: true });
  const { address: userAddress } = useAccount();

  const [metadata, setMetadata] = useState<MarketMetadata | null>(null);
  const [ipfsCid, setIpfsCid] = useState<string | null>(null);
  const [volume24hWei, setVolume24hWei] = useState<bigint | null | "loading">("loading");

  const [activeTab, setActiveTab] = useState<"buy" | "sell">("buy");
  const [buyOutcome, setBuyOutcome] = useState(0);
  const [tradeAmount, setTradeAmount] = useState<number | string>(0);
  const [txStatus, setTxStatus] = useState<string | null>(null);

  const { data: registryInfo } = useDeployedContractInfo({ contractName: "MarketRegistry" });
  const { data: adapterInfo } = useDeployedContractInfo({ contractName: "AiCTFAdapter" });
  const { data: ctfInfo } = useDeployedContractInfo({ contractName: "ConditionalTokens" });

  const { data: railRaw } = useScaffoldReadContract({
    contractName: "MarketRegistry",
    functionName: "marketSettlementRail",
    args: [questionId],
  });
  const rail: SettlementRail = railFromUint8(railRaw as bigint | undefined);

  const { data: ammUsdc } = useDeployedContractInfo({ contractName: "PredictionMarketAMM_USDC" });
  const { data: ammEurc } = useDeployedContractInfo({ contractName: "PredictionMarketAMM_EURC" });
  const ammInfo = rail === "EURC" ? ammEurc : ammUsdc;

  const { data: collateralUsdc } = useDeployedContractInfo({ contractName: "MockUSDC" });
  const { data: collateralEurc } = useDeployedContractInfo({ contractName: "MockEURC" });
  const collateralInfo = rail === "EURC" ? collateralEurc : collateralUsdc;

  const { data: creationEvents, isLoading: creationLoading } = useScaffoldEventHistory({
    contractName: "MarketRegistry",
    eventName: "MarketCreated",
    fromBlock: marketRegistryLogsFromBlock(chainId),
    filters: { questionId },
    enabled: !!questionId,
    blockData: true,
  });

  const { data: initEvents, isLoading: initLoading } = useScaffoldEventHistory({
    contractName: "AiCTFAdapter",
    eventName: "MarketInitialized",
    fromBlock: marketRegistryLogsFromBlock(chainId),
    filters: { questionId },
    enabled: !!questionId,
    blockData: true,
  });

  const creationEvent = pickEarliestLog(creationEvents);
  const initEvent = pickEarliestLog(initEvents);
  const birthLog = pickEarliestLog([...(creationEvents ?? []), ...(initEvents ?? [])]);

  const { data: resolvedEvents } = useScaffoldEventHistory({
    contractName: "AiCTFAdapter",
    eventName: "MarketResolved",
    fromBlock: marketRegistryLogsFromBlock(chainId),
    filters: { questionId },
    enabled: !!questionId,
  });
  const finalizeEvent = resolvedEvents?.[0];

  const { data: marketInfo } = useReadContract({
    address: registryInfo?.address,
    abi: registryInfo?.abi ?? [],
    functionName: "getMarket",
    args: [questionId],
  }) as { data: { outcomeCount: bigint; resolutionTime: bigint; status: number; exists: boolean } | undefined };

  const outcomeSlotCount =
    marketInfo?.exists && marketInfo.outcomeCount != null ? marketInfo.outcomeCount : undefined;

  const conditionId = computeConditionId(
    adapterInfo?.address as `0x${string}` | undefined,
    questionId,
    outcomeSlotCount,
  );

  const { yesTokenId, noTokenId } = computeOutcomeTokenIds(
    collateralInfo?.address as `0x${string}` | undefined,
    conditionId,
  );

  const { data: adapterQuestion } = useReadContract({
    address: adapterInfo?.address,
    abi: adapterInfo?.abi ?? [],
    functionName: "getQuestion",
    args: [questionId],
  }) as {
    data: { status: number; proposedAt: bigint; proposedPayouts: bigint[]; resolutionTime: bigint } | undefined;
  };

  const { data: disputeWindowSec } = useScaffoldReadContract({
    contractName: "AiCTFAdapter",
    functionName: "disputeWindow",
  });

  const { data: ammPool } = useReadContract({
    address: ammInfo?.address,
    abi: ammInfo?.abi ?? [],
    functionName: "getPool",
    args: [conditionId],
    query: { enabled: !!conditionId },
  }) as {
    data: {
      yesReserve: bigint;
      noReserve: bigint;
      usdcCollateral: bigint;
      resolved: boolean;
      exists: boolean;
    } | undefined;
  };

  const { data: yesProbability } = useReadContract({
    address: ammInfo?.address,
    abi: ammInfo?.abi ?? [],
    functionName: "getYesProbability",
    args: [conditionId],
    query: { enabled: !!conditionId },
  }) as { data: bigint | undefined };

  const tradeAmountWei = tradeAmount ? parseUnits(String(tradeAmount), 6) : 0n;

  const { data: buyPrice } = useReadContract({
    address: ammInfo?.address,
    abi: ammInfo?.abi ?? [],
    functionName: "getBuyPrice",
    args: [conditionId, BigInt(buyOutcome), tradeAmountWei],
    query: { enabled: !!conditionId && tradeAmountWei > 0n && activeTab === "buy" },
  }) as { data: bigint | undefined };

  const { data: sellPrice } = useReadContract({
    address: ammInfo?.address,
    abi: ammInfo?.abi ?? [],
    functionName: "getSellPrice",
    args: [conditionId, BigInt(buyOutcome), tradeAmountWei],
    query: { enabled: !!conditionId && tradeAmountWei > 0n && activeTab === "sell" },
  }) as { data: bigint | undefined };

  const { data: yesBalance } = useReadContract({
    address: ctfInfo?.address,
    abi: ctfInfo?.abi ?? [],
    functionName: "balanceOf",
    args: [userAddress, yesTokenId],
    query: { enabled: !!userAddress && !!yesTokenId },
  }) as { data: bigint | undefined };

  const { data: noBalance } = useReadContract({
    address: ctfInfo?.address,
    abi: ctfInfo?.abi ?? [],
    functionName: "balanceOf",
    args: [userAddress, noTokenId],
    query: { enabled: !!userAddress && !!noTokenId },
  }) as { data: bigint | undefined };

  const { data: collateralBalance } = useReadContract({
    address: collateralInfo?.address,
    abi: collateralInfo?.abi ?? [],
    functionName: "balanceOf",
    args: [userAddress],
    query: { enabled: !!userAddress && !!collateralInfo },
  }) as { data: bigint | undefined };

  const { data: payoutDenominator } = useReadContract({
    address: ctfInfo?.address,
    abi: ctfInfo?.abi ?? [],
    functionName: "payoutDenominator",
    args: [conditionId!],
    query: { enabled: !!ctfInfo?.address && !!conditionId && adapterQuestion?.status === 3 },
  }) as { data: bigint | undefined };

  const { writeContractAsync: writeAMMUsdc } = useScaffoldWriteContract({
    contractName: "PredictionMarketAMM_USDC",
  });
  const { writeContractAsync: writeAMMEurc } = useScaffoldWriteContract({
    contractName: "PredictionMarketAMM_EURC",
  });
  const { writeContractAsync: writeCollateralUsdc } = useScaffoldWriteContract({ contractName: "MockUSDC" });
  const { writeContractAsync: writeCollateralEurc } = useScaffoldWriteContract({ contractName: "MockEURC" });
  const writeAMM = rail === "EURC" ? writeAMMEurc : writeAMMUsdc;
  const writeCollateral = rail === "EURC" ? writeCollateralEurc : writeCollateralUsdc;

  const { writeContractAsync: writeCTF } = useScaffoldWriteContract({ contractName: "ConditionalTokens" });

  useEffect(() => {
    const fromLog =
      parseMarketCreatedIpfsCid(creationEvent) ?? parseMarketCreatedIpfsCid(initEvent);
    if (fromLog) {
      setIpfsCid(fromLog);
      return;
    }
    const stored = typeof window !== "undefined" ? localStorage.getItem(`market_cid_${questionId}`) : null;
    setIpfsCid(stored);
  }, [questionId, creationEvent, initEvent]);

  useEffect(() => {
    if (!ipfsCid) return;
    let cancelled = false;
    void (async () => {
      const data = await fetchIpfsJson<MarketMetadata>(ipfsCid);
      if (!cancelled && data) setMetadata(data);
    })();
    return () => {
      cancelled = true;
    };
  }, [ipfsCid]);

  useEffect(() => {
    if (!publicClient || !ammInfo?.address || !conditionId || latestBlock == null) {
      setVolume24hWei(null);
      return;
    }
    let cancelled = false;
    setVolume24hWei("loading");
    const fromBlock = volumeFromBlock(latestBlock, birthLog?.blockNumber, chainId);
    void (async () => {
      try {
        const addr = ammInfo.address as `0x${string}`;
        const [bought, sold] = await Promise.all([
          publicClient.getLogs({
            address: addr,
            event: TRADE_EVENTS_ABI[0],
            args: { conditionId },
            fromBlock,
            toBlock: latestBlock,
          }),
          publicClient.getLogs({
            address: addr,
            event: TRADE_EVENTS_ABI[1],
            args: { conditionId },
            fromBlock,
            toBlock: latestBlock,
          }),
        ]);
        let sum = 0n;
        for (const l of bought) {
          const a = l.args as { usdcPaid?: bigint };
          if (a?.usdcPaid != null) sum += a.usdcPaid;
        }
        for (const l of sold) {
          const a = l.args as { usdcReceived?: bigint };
          if (a?.usdcReceived != null) sum += a.usdcReceived;
        }
        if (!cancelled) setVolume24hWei(sum);
      } catch {
        if (!cancelled) setVolume24hWei(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [publicClient, ammInfo?.address, conditionId, latestBlock, birthLog?.blockNumber, chainId]);

  const yesProb = yesProbability ? Math.round((Number(yesProbability) / 1e6) * 100) : 50;
  const noProb = 100 - yesProb;
  const outcomes = metadata?.outcomes ?? ["Yes", "No"];
  const status = adapterQuestion?.status ?? 0;
  const isResolved = status === 3 || ammPool?.resolved;
  const statusLabel =
    ADAPTER_STATUS_LABELS[Math.min(status, ADAPTER_STATUS_LABELS.length - 1)] ?? "Unknown";
  const metadataPending = Boolean(ipfsCid) && !metadata;
  const displayTitle =
    metadata?.title ?? (ipfsCid ? "Loading market…" : `Market ${questionId.slice(0, 10)}…`);

  const currentBalance =
    activeTab === "buy"
      ? collateralBalance
        ? Number(formatUnits(collateralBalance, 6))
        : 0
      : buyOutcome === 0
        ? yesBalance
          ? Number(formatUnits(yesBalance, 6))
          : 0
        : noBalance
          ? Number(formatUnits(noBalance, 6))
          : 0;

  const insufficientBalance = Number(tradeAmount) > currentBalance;

  const breadcrumbs = metadata?.category ? [metadata.category] : [];
  const winnerIdx =
    adapterQuestion?.proposedPayouts?.[0] != null && adapterQuestion.proposedPayouts[0] > 0n ? 0 : 1;

  const yesBal = yesBalance ?? 0n;
  const noBal = noBalance ?? 0n;
  const payoutNums = adapterQuestion?.proposedPayouts ?? [];
  const payoutDen = payoutDenominator ?? 0n;
  const redeemIndexSets = buildRedeemIndexSets(yesBal, noBal);
  const redeemableWei =
    isResolved && payoutDen > 0n ? totalRedeemableCollateral(yesBal, noBal, payoutNums, payoutDen) : 0n;
  const canRedeem = Boolean(userAddress && redeemableWei > 0n && redeemIndexSets.length > 0);
  const redeemableDisplay =
    redeemableWei > 0n ? Number(formatUnits(redeemableWei, 6)).toFixed(2) : null;

  const { data: yesSellMark } = useReadContract({
    address: ammInfo?.address,
    abi: ammInfo?.abi ?? [],
    functionName: "getSellPrice",
    args: [conditionId!, 0n, yesBal],
    query: { enabled: !!conditionId && yesBal > 0n && !isResolved },
  }) as { data: bigint | undefined };

  const { data: noSellMark } = useReadContract({
    address: ammInfo?.address,
    abi: ammInfo?.abi ?? [],
    functionName: "getSellPrice",
    args: [conditionId!, 1n, noBal],
    query: { enabled: !!conditionId && noBal > 0n && !isResolved },
  }) as { data: bigint | undefined };

  const yesMarkValue =
    isResolved && payoutDen > 0n
      ? estimateOutcomeRedeemPayout(yesBal, payoutNums, 0, payoutDen)
      : (yesSellMark ?? 0n);
  const noMarkValue =
    isResolved && payoutDen > 0n
      ? estimateOutcomeRedeemPayout(noBal, payoutNums, 1, payoutDen)
      : (noSellMark ?? 0n);

  const endsTsMs =
    adapterQuestion?.resolutionTime && adapterQuestion.resolutionTime > 0n
      ? Number(adapterQuestion.resolutionTime) * 1000
      : marketInfo?.resolutionTime && marketInfo.resolutionTime > 0n
        ? Number(marketInfo.resolutionTime) * 1000
        : metadata?.resolutionTime
          ? metadata.resolutionTime * 1000
          : undefined;

  const resolutionEnded = endsTsMs != null && endsTsMs <= Date.now();

  /** Scaffold event history types omit `blockData` even when `blockData: true` is passed */
  const birthLogWithMeta = birthLog as
    | (typeof birthLog & { blockData?: { timestamp?: bigint } | null })
    | undefined;

  const birthTsMs = (() => {
    const bd = birthLogWithMeta?.blockData;
    if (!bd || typeof bd !== "object" || !("timestamp" in bd) || bd.timestamp == null) return undefined;
    return Number(bd.timestamp) * 1000;
  })();

  const creationTxHash =
    birthLog && typeof birthLog === "object" && "transactionHash" in birthLog
      ? (birthLog as { transactionHash?: `0x${string}` }).transactionHash
      : undefined;

  const creationLoadingBoth = creationLoading || initLoading;

  const creationSub = creationLoadingBoth
    ? "Loading…"
    : birthTsMs != null
      ? formatMarketDateTime(birthTsMs)
      : marketInfo?.exists
        ? "On-chain (confirming time)"
        : "Not indexed";

  const endsSub =
    endsTsMs != null
      ? formatMarketDateTime(endsTsMs)
      : metadata?.resolutionTime
        ? formatMarketDateTime(metadata.resolutionTime * 1000)
        : "—";

  const disputeEndMs =
    status === 2 &&
    adapterQuestion?.proposedAt != null &&
    adapterQuestion.proposedAt > 0n &&
    disputeWindowSec != null
      ? Number(adapterQuestion.proposedAt + disputeWindowSec) * 1000
      : undefined;

  let resolutionSub: string;
  if (isResolved) {
    resolutionSub = `${outcomes[winnerIdx]} wins`;
  } else if (status === 2 && disputeEndMs != null) {
    resolutionSub = `Dispute ends ${formatMarketDateTime(disputeEndMs)}`;
  } else if (status === 2) {
    resolutionSub = "Oracle proposal active";
  } else if (resolutionEnded && status === 1) {
    resolutionSub = "Awaiting oracle report";
  } else {
    resolutionSub = "Pending";
  }

  const resolutionReasoningText =
    metadata?.resolutionReasoning?.trim() ||
    metadata?.aiResolutionSummary?.trim() ||
    "";

  const finalizeTxHash =
    finalizeEvent && typeof finalizeEvent === "object" && "transactionHash" in finalizeEvent
      ? (finalizeEvent as { transactionHash?: `0x${string}` }).transactionHash
      : undefined;

  const creationTxLink = creationTxHash ? getBlockExplorerTxLink(chainId, creationTxHash) : "";
  const finalizeTxLink = finalizeTxHash ? getBlockExplorerTxLink(chainId, finalizeTxHash) : "";

  const handleTrade = async () => {
    if (activeTab === "buy") {
      if (!buyPrice || tradeAmountWei === 0n || !ammInfo || !conditionId) return;
      setTxStatus(`Approving ${rail}…`);
      try {
        await writeCollateral({ functionName: "approve", args: [ammInfo.address, buyPrice] });
        setTxStatus("Buying tokens...");
        await writeAMM({ functionName: "buyTokens", args: [conditionId, BigInt(buyOutcome), tradeAmountWei, buyPrice] });
        setTxStatus("✅ Bought!");
        setTradeAmount("");
      } catch (e) {
        setTxStatus(`❌ ${e instanceof Error ? e.message : "Error"}`);
      }
    } else {
      if (!sellPrice || tradeAmountWei === 0n || !ammInfo || !conditionId) return;
      setTxStatus("Approving CTF tokens...");
      try {
        await writeCTF({ functionName: "setApprovalForAll", args: [ammInfo.address, true] });
        setTxStatus("Selling tokens...");
        await writeAMM({ functionName: "sellTokens", args: [conditionId, BigInt(buyOutcome), tradeAmountWei, 0n] });
        setTxStatus("✅ Sold!");
        setTradeAmount("");
      } catch (e) {
        setTxStatus(`❌ ${e instanceof Error ? e.message : "Error"}`);
      }
    }
  };

  const handleRedeem = async () => {
    if (!canRedeem || !collateralInfo || !conditionId) return;
    setTxStatus("Redeeming...");
    try {
      await writeCTF({
        functionName: "redeemPositions",
        args: [collateralInfo.address, CTF_PARENT_COLLECTION_ZERO, conditionId, redeemIndexSets],
      });
      setTxStatus(
        redeemableDisplay
          ? `✅ Redeemed ~${redeemableDisplay} ${rail}!`
          : "✅ Redeemed!",
      );
    } catch (e) {
      setTxStatus(`❌ ${e instanceof Error ? e.message : "Error"}`);
    }
  };

  return (
    <div className="mx-auto max-w-[90rem] px-6 py-8 w-full flex gap-8 items-start relative">
      <div className="flex-1 min-w-0 flex flex-col gap-8">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-4 min-w-0">
            {metadataPending ? (
              <div className="size-14 rounded-xl bg-muted flex items-center justify-center shrink-0">
                <Spinner className="size-6 text-muted-foreground" />
              </div>
            ) : metadata?.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={metadata.imageUrl}
                alt={displayTitle}
                className="size-14 rounded-xl object-cover shrink-0"
              />
            ) : (
              <div className="size-14 rounded-xl bg-muted flex items-center justify-center text-2xl shrink-0">🔮</div>
            )}
            <div className="min-w-0">
              {breadcrumbs.length > 0 && (
                <div className="flex items-center gap-1 text-sm text-muted-foreground mb-1">
                  {breadcrumbs.map((label, i) => (
                    <span key={label}>
                      {i > 0 && <span className="mx-1">·</span>}
                      {label}
                    </span>
                  ))}
                </div>
              )}
              <div className="flex flex-wrap items-center gap-2 mb-1">
                <span className="text-[11px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-md bg-muted border border-border">
                  {statusLabel}
                </span>
                <span className="text-[11px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-md border border-sky-500/40 text-sky-700 dark:text-sky-400">
                  Settles in {rail}
                </span>
              </div>
              <h1 className="text-2xl font-semibold leading-snug">{displayTitle}</h1>
            </div>
          </div>

          <div className="flex items-center gap-1 shrink-0">
            <Button variant="ghost" size="icon-sm" type="button">
              <HugeiconsIcon icon={SourceCodeIcon} className="size-4" />
            </Button>
            <Button variant="ghost" size="icon-sm" type="button">
              <HugeiconsIcon icon={Link01Icon} className="size-4" />
            </Button>
            <Button variant="ghost" size="icon-sm" type="button">
              <HugeiconsIcon icon={Bookmark01Icon} className="size-4" />
            </Button>
          </div>
        </div>

        {!isResolved && <MarketChart yesProb={yesProb} noProb={noProb} />}

        <Collapsible className="my-2" defaultOpen>
          <Card size="sm" className="p-3.5 gap-3">
            <CollapsibleTrigger className="flex w-full items-center justify-between text-md font-medium cursor-pointer">
              Market Rules
              <HugeiconsIcon
                icon={ArrowDown01Icon}
                className="size-4 text-muted-foreground transition-transform [[data-state=open]_&]:rotate-180"
              />
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="flex items-start gap-2 text-sm text-muted-foreground pb-4 leading-relaxed whitespace-pre-line pt-3">
                <HugeiconsIcon icon={InformationCircleIcon} className="size-4 shrink-0 mt-0.5" />
                {metadata?.description || "No rules available for this market."}
              </div>
            </CollapsibleContent>
          </Card>
        </Collapsible>

        {ammPool?.exists && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Card size="sm" className="p-4 gap-1">
              <div className="text-xs text-muted-foreground uppercase font-semibold">Liquidity</div>
              <div className="font-semibold text-lg tabular-nums">${formatUnits(ammPool.usdcCollateral, 6)}</div>
            </Card>
            <Card size="sm" className="p-4 gap-1">
              <div className="text-xs text-muted-foreground uppercase font-semibold">Vol 24h</div>
              <div className="font-semibold text-lg tabular-nums">
                {volume24hWei === "loading"
                  ? "…"
                  : volume24hWei != null
                    ? `$${formatUnits(volume24hWei, 6)}`
                    : "—"}
              </div>
              <p className="text-[10px] text-muted-foreground leading-tight">
                Buys + sells on this pool (~last 24h, RPC estimate)
              </p>
            </Card>
          </div>
        )}
      </div>

      <div className="w-full max-w-[380px] shrink-0 self-start lg:sticky lg:top-8 flex flex-col gap-6">
        {userAddress && conditionId && (yesBal > 0n || noBal > 0n) && (
          <YourPositionCard
            conditionId={conditionId}
            yesBalance={yesBal}
            noBalance={noBal}
            yesMark={yesMarkValue}
            noMark={noMarkValue}
            resolved={Boolean(isResolved)}
          />
        )}
        <Card size="sm" className="rounded-2xl p-5 gap-6 ring-1 ring-border/80">
          <div className="flex items-center justify-between border-b pb-3">
            <div className="flex gap-6">
              <button
                type="button"
                onClick={() => {
                  setActiveTab("buy");
                  setTradeAmount(0);
                }}
                className={`pb-1 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === "buy"
                    ? "border-primary text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                Buy
              </button>
              <button
                type="button"
                onClick={() => {
                  setActiveTab("sell");
                  setTradeAmount(0);
                }}
                className={`pb-1 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === "sell"
                    ? "border-primary text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                Sell
              </button>
            </div>
          </div>

          {!isResolved ? (
            <>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setBuyOutcome(0)}
                  className={`rounded-lg py-2.5 text-sm font-semibold transition-colors border-0 ${
                    buyOutcome === 0
                      ? "bg-teal-50 text-teal-700 dark:bg-teal-950/40 dark:text-teal-400"
                      : "bg-muted text-muted-foreground hover:bg-muted/80"
                  }`}
                >
                  {outcomes[0]} {yesProb}¢
                </button>
                <button
                  type="button"
                  onClick={() => setBuyOutcome(1)}
                  className={`rounded-lg py-2.5 text-sm font-semibold transition-colors border-0 ${
                    buyOutcome === 1
                      ? "bg-red-50 text-red-700/80 dark:bg-red-950/30 dark:text-red-400"
                      : "bg-muted text-muted-foreground hover:bg-muted/80"
                  }`}
                >
                  {outcomes[1]} {noProb}¢
                </button>
              </div>

              <div className="flex items-center justify-between gap-4">
                <span className="text-sm text-muted-foreground shrink-0">Amount</span>
                <div className="flex items-center rounded-lg border overflow-hidden bg-background ml-auto">
                  <div className="px-2 text-muted-foreground text-sm">$</div>
                  <input
                    type="number"
                    min={0}
                    value={tradeAmount}
                    onChange={e => setTradeAmount(e.target.value)}
                    className="w-20 py-2 text-sm font-medium text-right bg-transparent outline-none px-2"
                  />
                </div>
              </div>

              <div className="flex justify-between text-xs text-muted-foreground">
                <span>{activeTab === "buy" ? `${rail} balance` : `${outcomes[buyOutcome]} shares`}</span>
                <span className="font-medium tabular-nums">{currentBalance.toFixed(2)}</span>
              </div>

              <Separator />

              <div className="space-y-2 text-sm">
                {activeTab === "buy" ? (
                  <>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Est. shares</span>
                      <span className="font-medium tabular-nums">{tradeAmount}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground underline decoration-dotted">Potential cost</span>
                      <span className="font-semibold text-teal-600 dark:text-teal-400 tabular-nums">
                        ${buyPrice && tradeAmountWei > 0n ? formatUnits(buyPrice, 6) : "0.00"}
                      </span>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Shares to sell</span>
                      <span className="font-medium tabular-nums">{tradeAmount}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground underline decoration-dotted">Est. return</span>
                      <span className="font-semibold text-teal-600 dark:text-teal-400 tabular-nums">
                        ${sellPrice && tradeAmountWei > 0n ? formatUnits(sellPrice, 6) : "0.00"}
                      </span>
                    </div>
                  </>
                )}
              </div>

              {insufficientBalance && (
                <p className="text-xs text-amber-600 dark:text-amber-400">
                  Insufficient balance for this order.
                </p>
              )}

              <Button
                type="button"
                className={`w-full h-12 border-0 ${
                  buyOutcome === 0
                    ? "bg-teal-50 text-teal-700 hover:bg-teal-200 dark:bg-teal-950/40 dark:text-teal-400 dark:hover:bg-teal-950/60"
                    : "bg-red-50 text-red-800 hover:bg-red-200 dark:bg-red-950/30 dark:text-red-400 dark:hover:bg-red-950/50"
                }`}
                disabled={!userAddress || Number(tradeAmount) <= 0 || insufficientBalance}
                onClick={handleTrade}
              >
                {!userAddress ? "Connect wallet" : `${activeTab === "buy" ? "Buy" : "Sell"} ${outcomes[buyOutcome]}`}
              </Button>
            </>
          ) : (
            <div className="text-center py-4 gap-4 flex flex-col">
              <div className="text-5xl leading-none">🎉</div>
              <h3 className="font-semibold">Market resolved</h3>
              <p className="text-sm text-muted-foreground">
                Winner: <span className="font-medium text-foreground">{outcomes[winnerIdx]}</span>
              </p>
              {resolutionReasoningText ? (
                <Card size="sm" className="text-left p-4 gap-2 bg-muted/40 ring-1 ring-border/60">
                  <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Resolution reasoning
                  </div>
                  <p className="text-sm whitespace-pre-wrap leading-relaxed">{resolutionReasoningText}</p>
                </Card>
              ) : (
                <p className="text-xs text-muted-foreground leading-relaxed px-1">
                  Narrative reasoning from the AI oracle is not stored on-chain for this deployment. If you publish an
                  updated IPFS metadata pin with <code className="text-[11px]">resolutionReasoning</code> or{" "}
                  <code className="text-[11px]">aiResolutionSummary</code>, it will appear here automatically.
                </p>
              )}
              {finalizeTxLink ? (
                <a
                  href={finalizeTxLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-primary hover:underline"
                >
                  View finalization transaction ↗
                </a>
              ) : null}
              {canRedeem ? (
                <Button type="button" variant="secondary" className="w-full" onClick={handleRedeem}>
                  Redeem ~{redeemableDisplay} {rail}
                </Button>
              ) : userAddress ? (
                <p className="text-xs text-muted-foreground leading-relaxed px-1">
                  You have no winning outcome tokens to redeem for this market. Only wallets that hold the winning
                  side&apos;s CTF positions receive collateral.
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">Connect a wallet to check redeemable winnings.</p>
              )}
            </div>
          )}

          {txStatus && (
            <p
              className={`text-xs text-center font-medium ${
                txStatus.includes("❌") ? "text-destructive" : "text-emerald-600 dark:text-emerald-400"
              }`}
            >
              {txStatus}
            </p>
          )}
        </Card>

        <Card size="sm" className="rounded-2xl p-5 gap-3 ring-1 ring-border/60 text-sm">
          <h3 className="font-semibold">Need {rail} to trade?</h3>
          <p className="text-muted-foreground leading-relaxed">
            Outcomes settle in {rail}. Swap into {rail} on a same-chain DEX where liquidity exists, or use the deposit
            flow for native USDC (CCTP Bridge Kit).
          </p>
          <div className="flex flex-wrap gap-2 pt-1">
            <Button variant="outline" size="sm" asChild>
              <Link href="/deposit">Deposit / bridge USDC</Link>
            </Button>
            <Button variant="ghost" size="sm" asChild>
              <a href="https://developers.circle.com/" target="_blank" rel="noopener noreferrer">
                Circle developer docs
              </a>
            </Button>
          </div>
        </Card>

        <Card size="sm" className="rounded-2xl p-5 gap-4 ring-1 ring-border/80">
          <h3 className="font-semibold text-lg">Timeline</h3>
          <div className="flex flex-col">
            {[
              {
                label: "Market created",
                sub: (
                  <span className="flex flex-col gap-0.5 items-end">
                    <span>{creationSub}</span>
                    {creationTxLink ? (
                      <a
                        href={creationTxLink}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary hover:underline font-medium"
                      >
                        Creation tx ↗
                      </a>
                    ) : null}
                  </span>
                ),
                done: Boolean(birthTsMs || marketInfo?.exists),
              },
              {
                label: "Market ends",
                sub: <span>{endsSub}</span>,
                done: resolutionEnded,
              },
              {
                label: "Market resolution",
                sub: (
                  <span className="flex flex-col gap-0.5 items-end">
                    <span>{resolutionSub}</span>
                    {isResolved && finalizeTxLink ? (
                      <a
                        href={finalizeTxLink}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary hover:underline font-medium"
                      >
                        Finalize tx ↗
                      </a>
                    ) : null}
                  </span>
                ),
                done: isResolved,
              },
            ].map((step, i, arr) => {
              const isActive = !step.done && arr.findIndex(s => !s.done) === i;
              return (
                <div key={step.label} className="flex gap-3">
                  <div className="flex flex-col items-center">
                    <div
                      className={`size-2.5 rounded-full shrink-0 mt-1.5 ${
                        step.done
                          ? "bg-violet-500 dark:bg-violet-400"
                          : isActive
                            ? "bg-foreground"
                            : "bg-muted-foreground/25"
                      }`}
                    />
                    {i < arr.length - 1 && (
                      <div
                        className={`w-px flex-1 min-h-[18px] ${
                          step.done ? "bg-violet-500/40 dark:bg-violet-400/30" : "bg-border"
                        }`}
                      />
                    )}
                  </div>
                  <div
                    className={`flex flex-1 justify-between gap-3 ${i < arr.length - 1 ? "pb-3" : ""} items-start`}
                  >
                    <span className={`text-sm shrink-0 ${isActive ? "font-medium" : "text-muted-foreground"}`}>
                      {step.label}
                    </span>
                    <div className="text-xs text-muted-foreground text-right min-w-0">{step.sub}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      </div>
    </div>
  );
}
