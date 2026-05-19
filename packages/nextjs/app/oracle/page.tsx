"use client";

import type { NextPage } from "next";
import Link from "next/link";
import { useState, useEffect, useMemo, type ChangeEvent } from "react";
import type { Abi } from "viem";
import { useAccount, useReadContract, useReadContracts } from "wagmi";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import {
  useDeployedContractInfo,
  useScaffoldReadContract,
  useScaffoldWriteContract,
  useScaffoldEventHistory,
  useTargetNetwork,
} from "~~/hooks/scaffold-eth";
import { filterVisibleMarkets } from "@/lib/market-blocklist";
import { fetchIpfsJson, marketRegistryLogsFromBlock, parseMarketCreatedIpfsCid } from "@/lib/market-ipfs";
import { useMarketChainId } from "~~/hooks/markets/useMarketMetadata";
import { canAddressFinalizeResolution } from "@/lib/adapter-finalize";
import { railFromUint8, type SettlementRail } from "@/lib/marketRails";

/**
 * Oracle / Resolution Panel
 *
 * This page replaces the single-market oracle page with a multi-market view.
 * It shows all markets that have pending resolutions (status = Proposed),
 * and provides:
 *   - Admin override controls (owner only, within dispute window)
 *   - Multisig override controls (signers only, within window)
 *   - Finalize resolution (owner, multisig signers, or automation upkeep — after window)
 */
const OraclePage: NextPage = () => {
  const { address: userAddress } = useAccount();
  const [selectedMarket, setSelectedMarket] = useState<`0x${string}` | null>(null);
  const [adminPayouts, setAdminPayouts] = useState(["1", "0"]);
  const [multisigPayouts, setMultisigPayouts] = useState(["1", "0"]);
  const [txStatus, setTxStatus] = useState<string | null>(null);

  const { data: registryInfo } = useDeployedContractInfo({ contractName: "MarketRegistry" });
  const { data: adapterInfo } = useDeployedContractInfo({ contractName: "AiCTFAdapter" });

  const { writeContractAsync: writeAdapter } = useScaffoldWriteContract({
    contractName: "AiCTFAdapter",
  });

  // All markets from registry
  const { data: allMarkets } = useReadContract({
    address: registryInfo?.address,
    abi: registryInfo?.abi ?? [],
    functionName: "getAllMarkets",
  }) as { data: `0x${string}`[] | undefined };

  // Check if current user is multisig signer
  const { data: isMultisigSigner } = useReadContract({
    address: adapterInfo?.address,
    abi: adapterInfo?.abi ?? [],
    functionName: "isMultisigSigner",
    args: [userAddress ?? "0x0000000000000000000000000000000000000000"],
  }) as { data: boolean | undefined };

  // Is user the owner?
  const { data: ownerAddr } = useScaffoldReadContract({
    contractName: "AiCTFAdapter",
    functionName: "owner",
  });
  const isOwner = userAddress?.toLowerCase() === (ownerAddr as string | undefined)?.toLowerCase();

  const { data: upkeepFinalizer } = useReadContract({
    address: adapterInfo?.address,
    abi: adapterInfo?.abi ?? [],
    functionName: "upkeepFinalizer",
    query: { enabled: !!adapterInfo?.address },
  }) as { data: `0x${string}` | undefined };

  const { data: multisigSignerList } = useScaffoldReadContract({
    contractName: "AiCTFAdapter",
    functionName: "getMultisigSigners",
  });

  const multisigSignerCount = Array.isArray(multisigSignerList) ? multisigSignerList.length : 0;

  const canUserFinalize = canAddressFinalizeResolution({
    caller: userAddress,
    owner: ownerAddr as string | undefined,
    isMultisigSigner: !!isMultisigSigner,
    upkeepFinalizer: upkeepFinalizer as string | undefined,
    multisigSignerCount,
  });

  const markets = useMemo(() => filterVisibleMarkets(allMarkets ?? []), [allMarkets]);

  const marketDetailContracts = useMemo(() => {
    const adapterAddr = adapterInfo?.address;
    const adapterAbi = adapterInfo?.abi ?? [];
    const regAddr = registryInfo?.address;
    const regAbi = registryInfo?.abi ?? [];
    if (!adapterAddr || !regAddr || markets.length === 0 || adapterAbi.length === 0 || regAbi.length === 0) {
      return [];
    }
    return markets.flatMap(qId => [
      { address: adapterAddr, abi: adapterAbi, functionName: "getQuestion" as const, args: [qId] },
      { address: adapterAddr, abi: adapterAbi, functionName: "getDisputeWindowEnd" as const, args: [qId] },
      { address: regAddr, abi: regAbi, functionName: "marketSettlementRail" as const, args: [qId] },
    ]);
  }, [markets, adapterInfo?.address, adapterInfo?.abi, registryInfo?.address, registryInfo?.abi]);

  const { data: detailResults, isPending: detailsPending } = useReadContracts({
    contracts: marketDetailContracts,
    query: { enabled: marketDetailContracts.length > 0 },
  });

  type Enriched = {
    questionId: `0x${string}`;
    status: number | undefined;
    settlementRail: SettlementRail | undefined;
    canFinalize: boolean;
    disputeActive: boolean;
  };

  const sortedMarkets: Enriched[] = useMemo(() => {
    if (markets.length === 0) return [];
    if (detailsPending || !detailResults || marketDetailContracts.length === 0) {
      return markets.map(q => ({
        questionId: q,
        status: undefined,
        settlementRail: undefined,
        canFinalize: false,
        disputeActive: false,
      }));
    }
    const rows: Enriched[] = markets.map((qId, i) => {
      const qRes = detailResults[i * 3];
      const wRes = detailResults[i * 3 + 1];
      const rRes = detailResults[i * 3 + 2];
      let status: number | undefined;
      if (qRes?.status === "success" && qRes.result != null) {
        status = (qRes.result as { status: number }).status;
      }
      let winEnd: bigint | undefined;
      if (wRes?.status === "success") winEnd = wRes.result as bigint;
      let settlementRail: SettlementRail | undefined;
      if (rRes?.status === "success") settlementRail = railFromUint8(rRes.result as bigint);
      const disputeEndMs = winEnd ? Number(winEnd) * 1000 : 0;
      const disputeActive = disputeEndMs > Date.now();
      const canFinalize = status === 2 && !disputeActive;
      return { questionId: qId, status, settlementRail, canFinalize, disputeActive };
    });
    const rank = (r: Enriched) => {
      if (r.canFinalize) return 0;
      if (r.status === 2 && r.disputeActive) return 1;
      if (r.status === 2) return 2;
      if (r.status === 1) return 3;
      if (r.status === 0) return 5;
      return 4;
    };
    return [...rows].sort((a, b) => rank(a) - rank(b));
  }, [markets, detailResults, detailsPending, marketDetailContracts.length]);

  const [jumpRaw, setJumpRaw] = useState("");

  const normalizedJumpId = useMemo(() => {
    const t = jumpRaw.trim();
    if (!t) return null;
    return (t.startsWith("0x") ? t : `0x${t}`) as `0x${string}`;
  }, [jumpRaw]);

  const jumpIdValid = normalizedJumpId != null && /^0x[a-fA-F0-9]{64}$/.test(normalizedJumpId);
  const jumpNotInFeed = jumpIdValid && !markets.includes(normalizedJumpId);

  const handleJumpToQuestion = () => {
    if (!normalizedJumpId || !jumpIdValid) return;
    setSelectedMarket(normalizedJumpId);
    setJumpRaw("");
  };

  const handleAdminOverride = async () => {
    if (!selectedMarket) return;
    setTxStatus("Submitting admin override...");
    try {
      await writeAdapter({
        functionName: "adminOverride",
        args: [selectedMarket, adminPayouts.map(BigInt)],
      });
      setTxStatus("✅ Override submitted — dispute window reset.");
    } catch (e) {
      setTxStatus(`❌ ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const handleAdminResolve = async () => {
    if (!selectedMarket) return;
    setTxStatus("Submitting owner resolution...");
    try {
      await writeAdapter({
        functionName: "adminResolve",
        args: [selectedMarket, adminPayouts.map(BigInt)],
      });
      setTxStatus("✅ Market resolved on-chain by owner (CTF payouts reported).");
    } catch (e) {
      setTxStatus(`❌ ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const handleMultisigOverride = async () => {
    if (!selectedMarket) return;
    setTxStatus("Submitting multisig approval...");
    try {
      await writeAdapter({
        functionName: "multisigOverride",
        args: [selectedMarket, multisigPayouts.map(BigInt)],
      });
      setTxStatus("✅ Multisig approval submitted.");
    } catch (e) {
      setTxStatus(`❌ ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const handleUseAiPayouts = (payouts: bigint[]) => {
    setMultisigPayouts(payouts.map(p => p.toString()));
  };

  const handleFinalizeResolution = async () => {
    if (!selectedMarket) return;
    setTxStatus("Finalizing resolution...");
    try {
      await writeAdapter({
        functionName: "finalizeResolution",
        args: [selectedMarket],
      });
      setTxStatus("✅ Market resolved on-chain via CTF!");
    } catch (e) {
      setTxStatus(`❌ ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  return (
    <div className="min-h-screen bg-muted/30">
      <div className="max-w-4xl mx-auto px-6 py-8 space-y-8">
        {/* ── Header ────────────────────────────────────────────────────── */}
        <div>
          <h1 className="text-3xl font-extrabold mb-1 tracking-tight">🔭 Resolution Panel</h1>
          <p className="text-muted-foreground text-sm">
            Markets that can be <strong className="font-medium text-foreground">finalized</strong> appear first. IPFS titles load when available; you can always go by <strong className="font-medium text-foreground">question id</strong>.
          </p>
        </div>

        {/* ── Role Badges ───────────────────────────────────────────────── */}
        <div className="flex gap-3 flex-wrap">
          {isOwner && (
            <span className="rounded-full bg-primary/15 text-primary px-3 py-1 text-sm font-semibold ring-1 ring-primary/20">
              👑 Contract Owner
            </span>
          )}
          {isMultisigSigner && (
            <span className="rounded-full bg-secondary text-secondary-foreground px-3 py-1 text-sm font-semibold">
              🔐 Multisig Signer
            </span>
          )}
          {!isOwner && !isMultisigSigner && canUserFinalize && (
            <span className="rounded-full border border-border bg-muted px-3 py-1 text-sm font-semibold text-muted-foreground">
              ⚙️ Finalizer
            </span>
          )}
          {!isOwner && !isMultisigSigner && !canUserFinalize && (
            <span className="rounded-full border border-border bg-muted px-3 py-1 text-sm font-semibold text-muted-foreground">
              👤 Observer
            </span>
          )}
        </div>

        {/* ── Market Selector ───────────────────────────────────────────── */}
        <div className="rounded-2xl border border-border bg-card text-card-foreground shadow-sm p-5 space-y-4">
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Select market</h3>
          {markets.length === 0 ? (
            <p className="text-muted-foreground text-sm">No markets deployed yet.</p>
          ) : (
            <>
              <div className="flex flex-col sm:flex-row gap-2 sm:items-end">
                <div className="flex-1 space-y-1">
                  <label htmlFor="oracle-jump-qid" className="text-xs font-medium text-muted-foreground">
                    Jump to question id (0x + 64 hex)
                  </label>
                  <input
                    id="oracle-jump-qid"
                    placeholder="0x..."
                    value={jumpRaw}
                    onChange={(e: ChangeEvent<HTMLInputElement>) => setJumpRaw(e.target.value)}
                    className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none ring-ring/40 focus-visible:ring-2 font-mono text-xs"
                  />
                </div>
                <Button type="button" variant="secondary" size="sm" className="shrink-0" disabled={!jumpIdValid} onClick={handleJumpToQuestion}>
                  Open
                </Button>
              </div>
              {jumpNotInFeed && (
                <p className="text-[11px] text-amber-700 dark:text-amber-400">
                  This id is not in the registry feed below; the detail panel still loads if the adapter knows this question.
                </p>
              )}
              {detailsPending && (
                <p className="text-xs text-muted-foreground flex items-center gap-2">
                  <Spinner className="size-3" /> Loading on-chain status…
                </p>
              )}
              <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                {sortedMarkets.map(row => (
                  <MarketRow
                    key={row.questionId}
                    questionId={row.questionId}
                    selected={selectedMarket === row.questionId}
                    onSelect={() => setSelectedMarket(row.questionId)}
                    adapterAddress={adapterInfo?.address}
                    adapterAbi={adapterInfo?.abi ?? []}
                    adapterStatus={row.status}
                    settlementRail={row.settlementRail}
                    canFinalize={row.canFinalize}
                    canUserFinalize={canUserFinalize}
                    disputeActive={row.disputeActive}
                    isMultisigSigner={!!isMultisigSigner}
                  />
                ))}
              </div>
            </>
          )}
        </div>

        {/* ── Selected Market Actions ───────────────────────────────────── */}
        {selectedMarket && (
          <SelectedMarketPanel
            questionId={selectedMarket}
            isOwner={isOwner}
            isMultisigSigner={!!isMultisigSigner}
            adminPayouts={adminPayouts}
            setAdminPayouts={setAdminPayouts}
            multisigPayouts={multisigPayouts}
            setMultisigPayouts={setMultisigPayouts}
            onAdminOverride={handleAdminOverride}
            onAdminResolve={handleAdminResolve}
            onMultisigOverride={handleMultisigOverride}
            onUseAiPayouts={handleUseAiPayouts}
            onFinalize={handleFinalizeResolution}
            canUserFinalize={canUserFinalize}
            adapterAddress={adapterInfo?.address}
            adapterAbi={adapterInfo?.abi ?? []}
          />
        )}

        {txStatus && (
          <div
            className={`rounded-lg border text-sm px-4 py-3 ${
              txStatus.startsWith("❌")
                ? "border-destructive/40 bg-destructive/10 text-destructive"
                : "border-emerald-500/40 bg-emerald-500/10 text-foreground"
            }`}
          >
            {txStatus}
          </div>
        )}
      </div>
    </div>
  );
};

// ── Sub-components ────────────────────────────────────────────────────────────

function MarketRow({
  questionId,
  selected,
  onSelect,
  adapterAddress,
  adapterAbi,
  adapterStatus,
  settlementRail,
  canFinalize,
  canUserFinalize,
  disputeActive,
  isMultisigSigner,
}: {
  questionId: `0x${string}`;
  selected: boolean;
  onSelect: () => void;
  adapterAddress?: `0x${string}`;
  adapterAbi: Abi;
  adapterStatus?: number;
  settlementRail?: SettlementRail;
  canFinalize?: boolean;
  canUserFinalize?: boolean;
  disputeActive?: boolean;
  isMultisigSigner?: boolean;
}) {
  const marketChainId = useMarketChainId();
  const { address: userAddress } = useAccount();
  const [metadata, setMetadata] = useState<{ title: string; category: string } | null>(null);

  const { data: hasApproved } = useReadContract({
    address: adapterAddress,
    abi: adapterAbi,
    functionName: "multisigApprovals",
    args: [questionId, userAddress ?? "0x0000000000000000000000000000000000000000"],
    query: { enabled: !!userAddress && !!adapterAddress },
  }) as { data: boolean | undefined };

  const { data: creationEvents, isLoading: eventsLoading } = useScaffoldEventHistory({
    contractName: "MarketRegistry",
    eventName: "MarketCreated",
    chainId: marketChainId,
    fromBlock: marketRegistryLogsFromBlock(marketChainId),
    filters: { questionId },
    enabled: !!questionId,
  });

  const creationEvent = creationEvents?.[0];

  useEffect(() => {
    const cid = parseMarketCreatedIpfsCid(creationEvent);
    if (!cid) return;
    let cancelled = false;
    void (async () => {
      const data = await fetchIpfsJson<{ title: string; category: string }>(cid);
      if (!cancelled && data) setMetadata(data);
    })();
    return () => {
      cancelled = true;
    };
  }, [creationEvent]);

  const STATUS = ["Uninit", "Active", "⚡ Proposed", "✅ Resolved"];
  const s = adapterStatus ?? 0;
  const statusLabel = adapterStatus === undefined ? "—" : (STATUS[s] ?? "Unknown");
  const shortLabel = `Market ${questionId.slice(0, 6)}…${questionId.slice(-4)}`;

  return (
    <button
      type="button"
      onClick={onSelect}
      className={`w-full text-left p-3 rounded-xl border transition-all ${
        selected ? "border-primary bg-primary/10 ring-2 ring-primary/15" : "border-border hover:border-muted-foreground/30"
      }`}
    >
      <div className="flex justify-between items-center gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            {settlementRail && (
              <span className="rounded-full bg-muted px-2 py-0.5 text-[9px] font-semibold">{settlementRail}</span>
            )}
            {metadata?.category && (
              <span className="rounded-full border border-border px-2 py-0.5 text-[9px] uppercase tracking-tighter text-muted-foreground">
                {metadata.category}
              </span>
            )}
            {canFinalize && canUserFinalize && (
              <span className="rounded-full bg-emerald-500/20 text-emerald-800 dark:text-emerald-300 px-2 py-0.5 text-[9px] font-bold">
                Finalize
              </span>
            )}
            {canFinalize && !canUserFinalize && (
              <span className="rounded-full bg-muted text-muted-foreground px-2 py-0.5 text-[9px] font-semibold">
                Awaiting finalizer
              </span>
            )}
            {adapterStatus === 2 && disputeActive && (
              <span className="rounded-full bg-amber-500/15 text-amber-800 dark:text-amber-300 px-2 py-0.5 text-[9px] font-semibold">
                Dispute
              </span>
            )}
          </div>
          <p className="text-[10px] text-muted-foreground font-mono truncate" title={questionId}>
            {questionId}
          </p>
          <h4 className="font-bold text-sm truncate flex items-center gap-2">
            {metadata?.title ?? shortLabel}
            {eventsLoading && !metadata && <Spinner className="size-3 shrink-0 text-muted-foreground" />}
          </h4>
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          <span
            className={`text-xs font-semibold rounded-full px-2 py-0.5 ${
              s === 2
                ? "bg-amber-500/15 text-amber-700 dark:text-amber-400"
                : s === 3
                  ? "bg-muted text-muted-foreground"
                  : "border border-border text-muted-foreground"
            }`}
          >
            {statusLabel}
          </span>
          {hasApproved && <span className="text-[9px] font-bold text-emerald-600 dark:text-emerald-400 uppercase">Signed ✓</span>}
          {isMultisigSigner && !hasApproved && s === 2 && (
            <span className="text-[9px] font-bold text-secondary uppercase italic">Needs sign</span>
          )}
        </div>
      </div>
    </button>
  );
}

function SelectedMarketPanel({
  questionId,
  isOwner,
  isMultisigSigner,
  adminPayouts,
  setAdminPayouts,
  multisigPayouts,
  setMultisigPayouts,
  onAdminOverride,
  onAdminResolve,
  onMultisigOverride,
  onUseAiPayouts,
  onFinalize,
  canUserFinalize,
  adapterAddress,
  adapterAbi,
}: {
  questionId: `0x${string}`;
  isOwner: boolean;
  isMultisigSigner: boolean;
  canUserFinalize: boolean;
  adminPayouts: string[];
  setAdminPayouts: (v: string[]) => void;
  multisigPayouts: string[];
  setMultisigPayouts: (v: string[]) => void;
  onAdminOverride: () => Promise<void>;
  onAdminResolve: () => Promise<void>;
  onMultisigOverride: () => Promise<void>;
  onUseAiPayouts: (payouts: bigint[]) => void;
  onFinalize: () => Promise<void>;
  adapterAddress?: `0x${string}`;
  adapterAbi: Abi;
}) {
  const marketChainId = useMarketChainId();
  const [panelMetadata, setPanelMetadata] = useState<{ title: string; description?: string } | null>(null);

  const { data: q } = useReadContract({
    address: adapterAddress,
    abi: adapterAbi,
    functionName: "getQuestion",
    args: [questionId],
  }) as {
    data: {
      status: number;
      proposedAt: bigint;
      proposedPayouts: bigint[];
      outcomeCount: bigint;
      resolutionTime: bigint;
    } | undefined;
  };

  const { targetNetwork } = useTargetNetwork();

  // Fetch creation event
  const { data: creationEvents } = useScaffoldEventHistory({
    contractName: "MarketRegistry",
    eventName: "MarketCreated",
    chainId: marketChainId,
    fromBlock: marketRegistryLogsFromBlock(marketChainId),
    filters: { questionId },
    enabled: !!questionId,
  });

  const creationEvent = creationEvents?.[0];

  useEffect(() => {
    const cid = parseMarketCreatedIpfsCid(creationEvent);
    if (!cid) {
      setPanelMetadata(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      const data = await fetchIpfsJson<{ title: string; description?: string }>(cid);
      if (!cancelled) setPanelMetadata(data);
    })();
    return () => {
      cancelled = true;
    };
  }, [creationEvent]);

  const { data: winEnd } = useReadContract({
    address: adapterAddress,
    abi: adapterAbi,
    functionName: "getDisputeWindowEnd",
    args: [questionId],
  }) as { data: bigint | undefined };

  const status = q?.status ?? 0;
  const disputeWindowEnd = winEnd ? Number(winEnd) * 1000 : 0;
  const disputeActive = disputeWindowEnd > Date.now();
  const minutesLeft = Math.max(0, Math.ceil((disputeWindowEnd - Date.now()) / 60000));

  const copyQuestionId = async () => {
    try {
      await navigator.clipboard.writeText(questionId);
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="space-y-5">
      {/* Prominent finalize + context */}
      <div className="rounded-2xl border border-border bg-card text-card-foreground shadow-sm p-5 space-y-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 space-y-1">
            <h2 className="text-lg font-semibold leading-tight">{panelMetadata?.title ?? "Resolve market"}</h2>
            {panelMetadata?.description && (
              <p className="text-xs text-muted-foreground line-clamp-3">{panelMetadata.description}</p>
            )}
            <div className="flex flex-wrap gap-2 pt-1">
              <Button type="button" variant="outline" size="sm" className="h-8 text-xs font-mono" onClick={copyQuestionId}>
                Copy question id
              </Button>
              <Button type="button" variant="outline" size="sm" className="h-8 text-xs" asChild>
                <Link href={`/markets/${questionId}`}>Open market page →</Link>
              </Button>
            </div>
          </div>
        </div>
        <p className="text-[11px] font-mono break-all text-muted-foreground bg-muted/50 rounded-md px-2 py-1.5">{questionId}</p>
      </div>

      {status === 1 && (
        <div className="rounded-2xl border border-sky-500/30 bg-sky-500/5 p-4 text-sm text-foreground">
          <p className="font-medium text-sky-900 dark:text-sky-100">This market is active</p>
          <p className="text-muted-foreground mt-1 text-xs leading-relaxed">
            CRE may still propose an outcome after the scheduled resolution time. The <strong>contract owner</strong> and <strong>multisig signers</strong> can resolve immediately with custom payouts — no need to wait (see Owner resolution below).
          </p>
        </div>
      )}

      {status === 2 && disputeActive && (
        <div className="rounded-2xl border border-amber-500/35 bg-amber-500/5 p-4 text-sm">
          <p className="font-medium text-amber-950 dark:text-amber-100">Dispute window open</p>
          <p className="text-muted-foreground mt-1 text-xs">
            About <strong>{minutesLeft}</strong> min left until an authorized finalizer (owner, multisig signer, or Chainlink upkeep) can execute the proposal. The owner can still <strong>resolve immediately</strong> with different payouts; signers can approve multisig payouts.
          </p>
        </div>
      )}

      {status === 2 && !disputeActive && (
        <div className="rounded-2xl border-2 border-emerald-500/45 bg-emerald-500/5 p-5 space-y-3">
          <h3 className="font-semibold text-emerald-950 dark:text-emerald-100">Ready to finalize</h3>
          {canUserFinalize ? (
            <>
              <p className="text-sm text-muted-foreground">
                The dispute window has ended. Your wallet may <strong>Finalize resolution</strong> for the current AI
                proposal. The owner can instead <strong>Resolve now</strong> below to change payouts and resolve in one
                step.
              </p>
              <Button
                id="btn-finalize"
                onClick={onFinalize}
                className="w-full bg-emerald-600 hover:bg-emerald-700 text-white gap-2"
                type="button"
              >
                Finalize resolution
              </Button>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              The dispute window has ended. Only the contract owner, multisig signers, or the registered Chainlink
              upkeep may call <code className="text-xs">finalizeResolution</code>. Automation may finalize this market
              without a manual transaction.
            </p>
          )}
          {!canUserFinalize && (
            <div className="rounded-lg border border-sky-500/25 bg-sky-500/5 py-2 px-3 text-xs text-muted-foreground flex gap-2 items-start">
              <Spinner className="size-4 shrink-0 mt-0.5" />
              <span>Waiting for an authorized finalizer or Chainlink Automation upkeep.</span>
            </div>
          )}
          {canUserFinalize && (
            <div className="rounded-lg border border-sky-500/25 bg-sky-500/5 py-2 px-3 text-xs text-muted-foreground flex gap-2 items-start">
              <Spinner className="size-4 shrink-0 mt-0.5" />
              <span>If Chainlink Automation is configured, an upkeep may finalize this shortly without your transaction.</span>
            </div>
          )}
        </div>
      )}

      {isOwner && (status === 1 || status === 2) && (
        <div className="rounded-2xl border border-primary/40 bg-card text-card-foreground shadow-sm p-5 space-y-4">
          <div>
            <h3 className="font-semibold flex items-center gap-2 flex-wrap">
              👑 Owner resolution
              <span className="rounded-full bg-primary/15 text-primary px-2 py-0.5 text-xs font-medium">anytime · Active or Proposed</span>
            </h3>
            <p className="text-xs text-muted-foreground mt-1">
              Submit payouts and resolve on the CTF immediately — bypasses resolution time, CRE, and the dispute window.
            </p>
          </div>
          <PayoutsInput
            label="Payouts"
            payouts={adminPayouts}
            onChange={setAdminPayouts}
            outcomeCount={Number(q?.outcomeCount ?? 2)}
          />
          <Button id="btn-admin-resolve" onClick={onAdminResolve} className="w-full" type="button">
            Resolve now (owner)
          </Button>
          {status === 1 && (
            <div className="space-y-2 pt-1 border-t border-border">
              <p className="text-[11px] text-muted-foreground">
                Optional: open a dispute window with these payouts (multisig / public finalize) instead of resolving in this transaction.
              </p>
              <Button id="btn-admin-propose-only" onClick={onAdminOverride} variant="outline" className="w-full" type="button">
                Propose only — start dispute window
              </Button>
            </div>
          )}
          {status === 2 && disputeActive && (
            <Button id="btn-admin-override" onClick={onAdminOverride} variant="outline" className="w-full" type="button">
              Replace proposal & reset dispute window
            </Button>
          )}
        </div>
      )}

      {/* Market Status */}
      <div className="rounded-2xl border border-border bg-card text-card-foreground shadow-sm p-5 space-y-3">
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">On-chain details</h3>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <span className="text-muted-foreground">Status</span>
            <p className="font-semibold">{["Uninit", "Active", "Proposed", "Resolved"][status]}</p>
          </div>
          <div>
            <span className="text-muted-foreground">Outcomes</span>
            <p className="font-semibold">{q?.outcomeCount?.toString() ?? "—"}</p>
          </div>
          {status === 2 && (
            <>
              <div className="col-span-2 sm:col-span-1">
                <span className="text-muted-foreground">AI Proposed</span>
                <p className="font-semibold font-mono text-xs">[{q?.proposedPayouts?.map(p => p.toString()).join(", ")}]</p>
              </div>
              <div>
                <span className="text-muted-foreground">Dispute window</span>
                <p className={`font-semibold ${disputeActive ? "text-amber-600 dark:text-amber-400" : "text-emerald-600 dark:text-emerald-400"}`}>
                  {disputeActive ? `${minutesLeft} min left` : "Elapsed ✓"}
                </p>
              </div>
            </>
          )}
        </div>

        {creationEvent && (
          <div className="pt-3 mt-3 border-t border-border grid grid-cols-2 gap-3 text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">
            <div className="flex flex-col">
              <span>Creation TX</span>
              <a
                href={`${targetNetwork.blockExplorers?.default.url}/tx/${creationEvent.transactionHash}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline font-mono"
              >
                {creationEvent.transactionHash.slice(0, 14)}...
              </a>
            </div>
            <div className="flex flex-col">
              <span>Event Index</span>
              <span className="font-mono text-muted-foreground">{creationEvent.logIndex}</span>
            </div>
          </div>
        )}
      </div>

      {/* Multisig (Active, or Proposed while dispute window open) */}
      {isMultisigSigner && (status === 1 || (status === 2 && disputeActive)) && (
        <MultisigActionPanel
          questionId={questionId}
          payouts={multisigPayouts}
          setPayouts={setMultisigPayouts}
          onOverride={onMultisigOverride}
          onUseAiPayouts={() => onUseAiPayouts(q?.proposedPayouts ?? [])}
          adapterAddress={adapterAddress}
          adapterAbi={adapterAbi}
          proposedPayouts={q?.proposedPayouts ?? []}
        />
      )}
    </div>
  );
}

function PayoutsInput({
  label,
  payouts,
  onChange,
  outcomeCount,
}: {
  label: string;
  payouts: string[];
  onChange: (v: string[]) => void;
  outcomeCount: number;
}) {
  const arr = Array.from({ length: outcomeCount }, (_, i) => payouts[i] ?? "0");
  return (
    <div className="space-y-2">
      <label className="text-sm font-medium">{label}</label>
      <div className="flex gap-2">
        {arr.map((v, i) => (
          <div key={i} className="flex-1">
            <label className="text-xs text-muted-foreground">Outcome [{i}]</label>
            <input
              type="number"
              min="0"
              className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none ring-ring/40 focus-visible:ring-2"
              value={v}
              onChange={e => {
                const next = [...arr];
                next[i] = e.target.value;
                onChange(next);
              }}
            />
          </div>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        e.g. [1, 0] = outcome 0 wins · [0, 1] = outcome 1 wins · [1, 1] = draw/split
      </p>
    </div>
  );
}

function MultisigActionPanel({
  questionId,
  payouts,
  setPayouts,
  onOverride,
  onUseAiPayouts,
  adapterAddress,
  adapterAbi,
  proposedPayouts,
}: {
  questionId: `0x${string}`;
  payouts: string[];
  setPayouts: (v: string[]) => void;
  onOverride: () => Promise<void>;
  onUseAiPayouts: () => void;
  adapterAddress?: `0x${string}`;
  adapterAbi: Abi;
  proposedPayouts: bigint[];
}) {
  const { address: userAddress } = useAccount();

  const { data: approvalCount } = useReadContract({
    address: adapterAddress,
    abi: adapterAbi,
    functionName: "multisigApprovalCount",
    args: [questionId],
  }) as { data: bigint | undefined };

  const { data: threshold } = useReadContract({
    address: adapterAddress,
    abi: adapterAbi,
    functionName: "multisigThreshold",
  }) as { data: bigint | undefined };

  const { data: hasApproved } = useReadContract({
    address: adapterAddress,
    abi: adapterAbi,
    functionName: "multisigApprovals",
    args: [questionId, userAddress ?? "0x0000000000000000000000000000000000000000"],
  }) as { data: boolean | undefined };

  const count = Number(approvalCount ?? 0n);
  const total = Number(threshold ?? 0n);
  const progress = total > 0 ? (count / total) * 100 : 0;

  return (
    <div className="rounded-2xl border border-secondary/35 bg-card text-card-foreground shadow-sm p-5 space-y-4">
      <div className="flex justify-between items-start gap-4 flex-wrap">
        <div className="min-w-0">
          <h3 className="font-semibold flex items-center gap-2 flex-wrap">
            🔐 Multisig resolution
            <span className="rounded-full bg-secondary text-secondary-foreground px-2 py-0.5 text-xs font-medium">
              Signers · Active or dispute
            </span>
          </h3>
          <p className="text-xs text-muted-foreground mt-1">
            Approve identical payouts. While the market is <strong>Active</strong>, the first signatures record the proposal; when approvals reach the threshold, resolution finalizes immediately (no CRE required).
          </p>
        </div>
        <div className="text-right shrink-0">
          <span className="text-xs font-bold text-secondary">
            {count} / {total} Signed
          </span>
          <div className="w-24 h-2 bg-muted rounded-full mt-1 overflow-hidden">
            <div className="bg-secondary h-full transition-all" style={{ width: `${progress}%` }} />
          </div>
        </div>
      </div>

      {hasApproved && (
        <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 py-2 px-3 text-xs text-foreground">
          ✅ You have already signed this proposal.
        </div>
      )}

      <div className="flex flex-col gap-3">
        <PayoutsInput
          label="Approve Payouts"
          payouts={payouts}
          onChange={setPayouts}
          outcomeCount={Math.max(proposedPayouts.length, 2)}
        />
        {proposedPayouts.length > 0 && (
          <Button
            onClick={onUseAiPayouts}
            variant="ghost"
            size="xs"
            type="button"
            className="w-fit px-2 text-secondary hover:text-secondary"
          >
            ✨ Use AI Proposed Payouts
          </Button>
        )}
      </div>

      <Button
        id="btn-multisig-override"
        onClick={onOverride}
        disabled={hasApproved}
        variant="secondary"
        className="w-full"
        type="button"
      >
        {hasApproved ? "Already Approved" : "Sign & Approve"}
      </Button>
    </div>
  );
}

export default OraclePage;
