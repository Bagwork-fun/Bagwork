"use client";

import type { NextPage } from "next";
import Link from "next/link";
import { useMemo, useState } from "react";
import { formatUnits, parseUnits, keccak256, encodePacked, type Abi, type Address, erc20Abi } from "viem";
import { useAccount, useReadContract, usePublicClient, useWriteContract } from "wagmi";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { useDeployedContractInfo, useScaffoldWriteContract } from "~~/hooks/scaffold-eth";
import { filterVisibleMarkets } from "@/lib/market-blocklist";
import { railFromUint8, type SettlementRail } from "@/lib/marketRails";
import { showMockMintControls } from "@/lib/collateralToken";
import { LpPnLBreakdown } from "@/components/liquidity/lp-pnl-breakdown";
import { OUTCOME_SHARE_DECIMALS } from "@/lib/market-decimals";
import { CTF_PARENT_COLLECTION_ZERO, lockedLiquidityValidationError } from "@/lib/market-tokens";

/**
 * Liquidity Provider Panel — dual rail (USDC / EURC AMM instances).
 *
 * Pools are listed per collateral rail. Add/remove approves the AMM’s real `collateral()` token (official stables or mocks).
 */
type PoolEntry = { conditionId: `0x${string}`; rail: SettlementRail };

const LiquidityProviderPage: NextPage = () => {
  const { address: userAddress } = useAccount();
  const publicClient = usePublicClient();
  const { writeContractAsync: writeErc20 } = useWriteContract();
  const [selectedPool, setSelectedPool] = useState<PoolEntry | null>(null);
  const [addAmount, setAddAmount] = useState("");
  const [removeAmount, setRemoveAmount] = useState("");
  const [txStatus, setTxStatus] = useState<string | null>(null);
  const [showCreatePool, setShowCreatePool] = useState(false);

  const { data: ammUsdcInfo } = useDeployedContractInfo({ contractName: "PredictionMarketAMM_USDC" });
  const { data: ammEurcInfo } = useDeployedContractInfo({ contractName: "PredictionMarketAMM_EURC" });
  const { data: usdcInfo } = useDeployedContractInfo({ contractName: "MockUSDC" });
  const { data: eurcInfo } = useDeployedContractInfo({ contractName: "MockEURC" });

  const { writeContractAsync: writeAMMUsdc } = useScaffoldWriteContract({ contractName: "PredictionMarketAMM_USDC" });
  const { writeContractAsync: writeAMMEurc } = useScaffoldWriteContract({ contractName: "PredictionMarketAMM_EURC" });
  const { writeContractAsync: writeUsdc } = useScaffoldWriteContract({ contractName: "MockUSDC" });
  const { writeContractAsync: writeEurc } = useScaffoldWriteContract({ contractName: "MockEURC" });

  const { data: poolsUsdc } = useReadContract({
    address: ammUsdcInfo?.address,
    abi: ammUsdcInfo?.abi ?? [],
    functionName: "getAllPools",
    query: { enabled: !!ammUsdcInfo?.address },
  }) as { data: `0x${string}`[] | undefined };

  const { data: poolsEurc } = useReadContract({
    address: ammEurcInfo?.address,
    abi: ammEurcInfo?.abi ?? [],
    functionName: "getAllPools",
    query: { enabled: !!ammEurcInfo?.address },
  }) as { data: `0x${string}`[] | undefined };

  /** Actual ERC-20 the USDC-rail AMM pulls from (official USDC on Arc / Sepolia, or mock on localhost). */
  const { data: usdcCollateralAddr } = useReadContract({
    address: ammUsdcInfo?.address,
    abi: ammUsdcInfo?.abi ?? [],
    functionName: "collateral",
    query: { enabled: !!ammUsdcInfo?.address },
  }) as { data: Address | undefined };

  const { data: eurcCollateralAddr } = useReadContract({
    address: ammEurcInfo?.address,
    abi: ammEurcInfo?.abi ?? [],
    functionName: "collateral",
    query: { enabled: !!ammEurcInfo?.address },
  }) as { data: Address | undefined };

  const mergedPools = useMemo<PoolEntry[]>(
    () => [
      ...(poolsUsdc ?? []).map(conditionId => ({ conditionId, rail: "USDC" as const })),
      ...(poolsEurc ?? []).map(conditionId => ({ conditionId, rail: "EURC" as const })),
    ],
    [poolsUsdc, poolsEurc],
  );

  const usdcMintable = showMockMintControls(usdcCollateralAddr, usdcInfo?.abi ?? []);
  const eurcMintable = showMockMintControls(eurcCollateralAddr, eurcInfo?.abi ?? []);

  const selectedAmmInfo = selectedPool?.rail === "EURC" ? ammEurcInfo : ammUsdcInfo;
  const selectedCollateralAddress = selectedPool?.rail === "EURC" ? eurcCollateralAddr : usdcCollateralAddr;

  const handleAddLiquidity = async () => {
    if (!selectedPool || !addAmount || !selectedAmmInfo?.address || !selectedCollateralAddress || !publicClient) return;
    const amount = parseUnits(addAmount, 6);
    setTxStatus(`Approving ${selectedPool.rail}…`);
    try {
      const approveHash = await writeErc20({
        address: selectedCollateralAddress,
        abi: erc20Abi,
        functionName: "approve",
        args: [selectedAmmInfo.address, amount],
      });
      if (approveHash) {
        await publicClient.waitForTransactionReceipt({ hash: approveHash });
      }
      setTxStatus("Adding liquidity…");
      if (selectedPool.rail === "EURC") {
        await writeAMMEurc({ functionName: "addLiquidity", args: [selectedPool.conditionId, amount] });
      } else {
        await writeAMMUsdc({ functionName: "addLiquidity", args: [selectedPool.conditionId, amount] });
      }
      setTxStatus("✅ Liquidity added!");
      setAddAmount("");
    } catch (e) {
      setTxStatus(`❌ ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const handleRemoveLiquidity = async () => {
    if (!selectedPool || !removeAmount) return;
    const amount = parseUnits(removeAmount, 6);
    setTxStatus("Removing liquidity…");
    try {
      if (selectedPool.rail === "EURC") {
        await writeAMMEurc({ functionName: "removeLiquidity", args: [selectedPool.conditionId, amount] });
      } else {
        await writeAMMUsdc({ functionName: "removeLiquidity", args: [selectedPool.conditionId, amount] });
      }
      setTxStatus("✅ Liquidity removed!");
      setRemoveAmount("");
    } catch (e) {
      setTxStatus(`❌ ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const handleWithdrawRevenue = async () => {
    if (!selectedPool) return;
    setTxStatus("Withdrawing revenue…");
    try {
      if (selectedPool.rail === "EURC") {
        await writeAMMEurc({ functionName: "withdrawAfterResolution", args: [selectedPool.conditionId] });
      } else {
        await writeAMMUsdc({ functionName: "withdrawAfterResolution", args: [selectedPool.conditionId] });
      }
      setTxStatus("✅ Revenue withdrawn!");
    } catch (e) {
      setTxStatus(`❌ ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const handleMintUsdc = async () => {
    if (!userAddress) return;
    setTxStatus("Minting 10,000 Mock USDC…");
    try {
      await writeUsdc({ functionName: "mint", args: [userAddress, parseUnits("10000", 6)] });
      setTxStatus("✅ 10,000 USDC minted!");
    } catch (e) {
      setTxStatus(`❌ ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const handleMintEurc = async () => {
    if (!userAddress) return;
    setTxStatus("Minting 10,000 Mock EURC…");
    try {
      await writeEurc({ functionName: "mint", args: [userAddress, parseUnits("10000", 6)] });
      setTxStatus("✅ 10,000 EURC minted!");
    } catch (e) {
      setTxStatus(`❌ ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  return (
    <div className="min-h-screen bg-muted/30">
      <div className="max-w-5xl mx-auto px-6 py-8 space-y-8">
        <div className="flex items-start justify-between flex-wrap gap-4">
          <div>
            <h1 className="text-3xl font-extrabold mb-1 tracking-tight">💧 Liquidity Provider</h1>
            <p className="text-muted-foreground text-sm">
              Add / remove uses the <strong>same ERC-20 as each AMM</strong> (official Circle USDC/EURC on Arc, mocks on
              local). Approvals always target <code className="text-xs">AMM.collateral()</code>.
            </p>
          </div>
          <div className="flex flex-wrap gap-2 justify-end">
            {usdcMintable && (
              <Button onClick={handleMintUsdc} variant="outline" size="sm" type="button">
                Mint USDC
              </Button>
            )}
            {eurcMintable && (
              <Button onClick={handleMintEurc} variant="outline" size="sm" type="button">
                Mint EURC
              </Button>
            )}
            {!usdcMintable && !eurcMintable && (
              <Button variant="outline" size="sm" asChild type="button">
                <Link href="/deposit">Get USDC</Link>
              </Button>
            )}
            <Button id="btn-create-pool" onClick={() => setShowCreatePool(true)} size="sm" type="button">
              + Create Pool
            </Button>
          </div>
        </div>

        <div className="rounded-2xl border border-border bg-card text-card-foreground shadow-sm p-5">
          <h3 className="text-sm font-semibold text-muted-foreground mb-4 uppercase tracking-wide">
            Existing Pools ({mergedPools.length})
          </h3>
          {mergedPools.length === 0 ? (
            <p className="text-muted-foreground text-sm py-4 text-center">
              No pools yet. Create one for a registered market on the correct rail.
            </p>
          ) : (
            <div className="space-y-3">
              {mergedPools.map(({ conditionId, rail }) => (
                <PoolRow
                  key={`${rail}-${conditionId}`}
                  conditionId={conditionId}
                  rail={rail}
                  selected={selectedPool?.conditionId === conditionId && selectedPool?.rail === rail}
                  onSelect={() => setSelectedPool({ conditionId, rail })}
                  ammUsdcAddress={ammUsdcInfo?.address}
                  ammUsdcAbi={ammUsdcInfo?.abi ?? []}
                  ammEurcAddress={ammEurcInfo?.address}
                  ammEurcAbi={ammEurcInfo?.abi ?? []}
                  userAddress={userAddress}
                />
              ))}
            </div>
          )}
        </div>

        {selectedPool && selectedAmmInfo && (
          <SelectedPoolPanel
            rail={selectedPool.rail}
            conditionId={selectedPool.conditionId}
            addAmount={addAmount}
            setAddAmount={setAddAmount}
            removeAmount={removeAmount}
            setRemoveAmount={setRemoveAmount}
            onAdd={handleAddLiquidity}
            onRemove={handleRemoveLiquidity}
            onWithdraw={handleWithdrawRevenue}
            ammAddress={selectedAmmInfo.address}
            ammAbi={selectedAmmInfo.abi ?? []}
            collateralTokenAddress={selectedCollateralAddress}
            userAddress={userAddress}
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

        {showCreatePool && (
          <CreatePoolModal
            onClose={() => setShowCreatePool(false)}
            onCreated={(conditionId, rail) => {
              setShowCreatePool(false);
              setSelectedPool({ conditionId, rail });
              setTxStatus("✅ Pool created!");
            }}
          />
        )}
      </div>
    </div>
  );
};

function PoolRow({
  conditionId,
  rail,
  selected,
  onSelect,
  ammUsdcAddress,
  ammUsdcAbi,
  ammEurcAddress,
  ammEurcAbi,
  userAddress,
}: {
  conditionId: `0x${string}`;
  rail: SettlementRail;
  selected: boolean;
  onSelect: () => void;
  ammUsdcAddress?: Address;
  ammUsdcAbi: Abi;
  ammEurcAddress?: Address;
  ammEurcAbi: Abi;
  userAddress?: Address;
}) {
  const ammAddress = rail === "EURC" ? ammEurcAddress : ammUsdcAddress;
  const ammAbi = rail === "EURC" ? ammEurcAbi : ammUsdcAbi;

  const { data: pool } = useReadContract({
    address: ammAddress,
    abi: ammAbi,
    functionName: "getPool",
    args: [conditionId],
  }) as { data: { usdcCollateral: bigint; lpTradingRevenue: bigint; lpOwner: string; resolved: boolean } | undefined };

  const isMyPool = pool?.lpOwner?.toLowerCase() === userAddress?.toLowerCase();

  return (
    <button
      type="button"
      onClick={onSelect}
      className={`w-full text-left p-4 rounded-xl border transition-all ${
        selected ? "border-primary bg-primary/10 ring-2 ring-primary/20" : "border-border hover:border-muted-foreground/30"
      }`}
    >
      <div className="flex justify-between items-center flex-wrap gap-2">
        <div>
          <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold mr-2">{rail}</span>
          <span className="font-mono text-xs text-muted-foreground">{conditionId.slice(0, 20)}…</span>
          <div className="flex gap-2 mt-1">
            {isMyPool && (
              <span className="rounded-full bg-primary/15 text-primary px-2 py-0.5 text-xs font-medium">My Pool</span>
            )}
            {pool?.resolved && (
              <span className="rounded-full bg-muted text-muted-foreground px-2 py-0.5 text-xs font-medium">Resolved</span>
            )}
          </div>
        </div>
        <div className="text-right text-sm">
          <div className="font-bold">
            {formatUnits(pool?.usdcCollateral ?? 0n, 6)} {rail}
          </div>
          {isMyPool ? (
            <LpPnLBreakdown
              conditionId={conditionId}
              rail={rail}
              lpOwner={userAddress as Address | undefined}
              compact
            />
          ) : (
            <div className="text-xs text-muted-foreground">
              Rev {formatUnits(pool?.lpTradingRevenue ?? 0n, 6)} {rail}
            </div>
          )}
        </div>
      </div>
    </button>
  );
}

function SelectedPoolPanel({
  rail,
  conditionId,
  addAmount,
  setAddAmount,
  removeAmount,
  setRemoveAmount,
  onAdd,
  onRemove,
  onWithdraw,
  ammAddress,
  ammAbi,
  collateralTokenAddress,
  userAddress,
}: {
  rail: SettlementRail;
  conditionId: `0x${string}`;
  addAmount: string;
  setAddAmount: (v: string) => void;
  removeAmount: string;
  setRemoveAmount: (v: string) => void;
  onAdd: () => Promise<void>;
  onRemove: () => Promise<void>;
  onWithdraw: () => Promise<void>;
  ammAddress?: Address;
  ammAbi: Abi;
  collateralTokenAddress?: Address;
  userAddress?: Address;
}) {
  const { data: walletCollateralBal } = useReadContract({
    address: collateralTokenAddress,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: userAddress ? [userAddress] : undefined,
    query: { enabled: !!collateralTokenAddress && !!userAddress },
  }) as { data: bigint | undefined };

  const { data: pool } = useReadContract({
    address: ammAddress,
    abi: ammAbi,
    functionName: "getPool",
    args: [conditionId],
  }) as {
    data: {
      yesReserve: bigint;
      noReserve: bigint;
      usdcCollateral: bigint;
      lpTradingRevenue: bigint;
      lpOwner: string;
      resolved: boolean;
    } | undefined;
  };

  const isMyPool = pool?.lpOwner?.toLowerCase() === userAddress?.toLowerCase();
  const collateralLabel = rail;

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
      <div className="rounded-2xl border border-border bg-card text-card-foreground shadow-sm p-5 space-y-3 text-sm">
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Pool Stats ({rail})</h3>
        {[
          [`Total collateral (${rail})`, `${formatUnits(pool?.usdcCollateral ?? 0n, 6)}`],
          [`Trading revenue (${rail})`, `${formatUnits(pool?.lpTradingRevenue ?? 0n, 6)}`],
          ["YES Reserve", `${formatUnits(pool?.yesReserve ?? 0n, OUTCOME_SHARE_DECIMALS)} tokens`],
          ["NO Reserve", `${formatUnits(pool?.noReserve ?? 0n, OUTCOME_SHARE_DECIMALS)} tokens`],
          ["Resolved", pool?.resolved ? "✅ Yes" : "❌ No"],
        ].map(([k, v]) => (
          <div key={k} className="flex justify-between">
            <span className="text-muted-foreground">{k}</span>
            <span className="font-medium">{v}</span>
          </div>
        ))}
        {isMyPool && (
          <div className="border-t pt-3 mt-3">
            <h4 className="text-xs font-semibold text-muted-foreground uppercase mb-2">LP PnL</h4>
            <LpPnLBreakdown conditionId={conditionId} rail={rail} lpOwner={userAddress as Address | undefined} />
          </div>
        )}
      </div>

      <div className="rounded-2xl border border-border bg-card text-card-foreground shadow-sm p-5 space-y-4">
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
          Manage Liquidity {!isMyPool && "(read-only — not your pool)"}
        </h3>
        {collateralTokenAddress && userAddress && (
          <p className="text-xs text-muted-foreground">
            Wallet balance:{" "}
            <span className="font-medium text-foreground">
              {formatUnits(walletCollateralBal ?? 0n, 6)} {rail}
            </span>
            <span className="font-mono text-[10px] ml-2 opacity-80" title={collateralTokenAddress}>
              ({collateralTokenAddress.slice(0, 6)}…{collateralTokenAddress.slice(-4)})
            </span>
          </p>
        )}

        {isMyPool && !pool?.resolved && (
          <>
            <div>
              <label className="text-xs font-semibold text-muted-foreground">Add liquidity ({collateralLabel})</label>
              <div className="flex gap-2 mt-1">
                <input
                  id="input-add-liquidity"
                  type="number"
                  className="flex h-9 flex-1 min-w-0 rounded-md border border-input bg-background px-3 text-sm outline-none ring-ring/40 focus-visible:ring-2"
                  placeholder="100"
                  value={addAmount}
                  onChange={e => setAddAmount(e.target.value)}
                  min="0"
                />
                <Button id="btn-add-liquidity" onClick={onAdd} disabled={!addAmount} size="sm" type="button">
                  Add
                </Button>
              </div>
            </div>

            <div>
              <label className="text-xs font-semibold text-muted-foreground">Remove liquidity ({collateralLabel})</label>
              <div className="flex gap-2 mt-1">
                <input
                  id="input-remove-liquidity"
                  type="number"
                  className="flex h-9 flex-1 min-w-0 rounded-md border border-input bg-background px-3 text-sm outline-none ring-ring/40 focus-visible:ring-2"
                  placeholder="50"
                  value={removeAmount}
                  onChange={e => setRemoveAmount(e.target.value)}
                  min="0"
                />
                <Button
                  id="btn-remove-liquidity"
                  variant="outline"
                  className="border-destructive/50 text-destructive hover:bg-destructive/10"
                  onClick={onRemove}
                  disabled={!removeAmount}
                  size="sm"
                  type="button"
                >
                  Remove
                </Button>
              </div>
            </div>
          </>
        )}

        {isMyPool && pool?.resolved && (
          <div className="space-y-3">
            <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 text-xs p-3 text-foreground">
              Market resolved. Withdraw pulls trading revenue and redeems AMM pool reserves. Redeem wallet-held CTF
              tokens on the market page if needed.
            </div>
            <Button id="btn-withdraw-revenue" onClick={onWithdraw} variant="secondary" className="w-full" type="button">
              Withdraw all (revenue + pool reserves) · {formatUnits(pool?.lpTradingRevenue ?? 0n, 6)}+ {rail}
            </Button>
          </div>
        )}

        {!isMyPool && <p className="text-sm text-muted-foreground">You are not the LP owner of this pool.</p>}
      </div>
    </div>
  );
}

function CreatePoolModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (conditionId: `0x${string}`, rail: SettlementRail) => void;
}) {
  const [selectedMarket, setSelectedMarket] = useState<`0x${string}` | "">("");
  const [collateralAmount, setCollateralAmount] = useState("1000");
  const [initialYesProb, setInitialYesProb] = useState("50");
  const [percentageLocked, setPercentageLocked] = useState("10");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const { data: registryInfo } = useDeployedContractInfo({ contractName: "MarketRegistry" });
  const { data: adapterInfo } = useDeployedContractInfo({ contractName: "AiCTFAdapter" });
  const { data: ammUsdcInfo } = useDeployedContractInfo({ contractName: "PredictionMarketAMM_USDC" });
  const { data: ammEurcInfo } = useDeployedContractInfo({ contractName: "PredictionMarketAMM_EURC" });
  const { data: ctfDeploymentInfo } = useDeployedContractInfo({ contractName: "ConditionalTokens" });

  const { writeContractAsync: writeAMMUsdc } = useScaffoldWriteContract({ contractName: "PredictionMarketAMM_USDC" });
  const { writeContractAsync: writeAMMEurc } = useScaffoldWriteContract({ contractName: "PredictionMarketAMM_EURC" });

  const { data: allMarkets } = useReadContract({
    address: registryInfo?.address,
    abi: registryInfo?.abi ?? [],
    functionName: "getAllMarkets",
  }) as { data: readonly `0x${string}`[] | undefined };

  const visibleMarkets = useMemo(() => filterVisibleMarkets([...(allMarkets ?? [])]), [allMarkets]);

  const { data: marketStruct } = useReadContract({
    address: registryInfo?.address,
    abi: registryInfo?.abi ?? [],
    functionName: "getMarket",
    args: selectedMarket ? [selectedMarket] : undefined,
    query: { enabled: !!registryInfo?.address && !!selectedMarket },
  }) as {
    data: { outcomeCount: bigint; resolutionTime: bigint; status: number; exists: boolean } | undefined;
  };

  const { data: railRaw } = useReadContract({
    address: registryInfo?.address,
    abi: registryInfo?.abi ?? [],
    functionName: "marketSettlementRail",
    args: selectedMarket ? [selectedMarket] : undefined,
    query: { enabled: !!registryInfo?.address && !!selectedMarket },
  }) as { data: bigint | undefined };

  const rail: SettlementRail | undefined = railRaw !== undefined ? railFromUint8(railRaw) : undefined;

  const ammInfo = rail === "EURC" ? ammEurcInfo : ammUsdcInfo;

  const { data: ammCollateralAddr } = useReadContract({
    address: ammInfo?.address,
    abi: ammInfo?.abi ?? [],
    functionName: "collateral",
    query: { enabled: !!ammInfo?.address && !!rail },
  }) as { data: Address | undefined };

  const adapterAddr = adapterInfo?.address as `0x${string}` | undefined;
  const outcomeCount = marketStruct?.exists ? marketStruct.outcomeCount : undefined;

  const conditionId =
    adapterAddr && selectedMarket && outcomeCount != null
      ? keccak256(encodePacked(["address", "bytes32", "uint256"], [adapterAddr, selectedMarket, outcomeCount]))
      : undefined;

  const { data: ctfAddr } = useReadContract({
    address: ammInfo?.address,
    abi: ammInfo?.abi ?? [],
    functionName: "ctf",
    query: { enabled: !!ammInfo?.address && !!rail },
  }) as { data: Address | undefined };

  const ctfAbi = ctfDeploymentInfo?.abi ?? [];

  const { data: yesCollectionId } = useReadContract({
    address: ctfAddr,
    abi: ctfAbi,
    functionName: "getCollectionId",
    args: conditionId ? [CTF_PARENT_COLLECTION_ZERO, conditionId, 1n] : undefined,
    query: { enabled: !!ctfAddr && !!conditionId && outcomeCount === 2n && ctfAbi.length > 0 },
  }) as { data: `0x${string}` | undefined };

  const { data: noCollectionId } = useReadContract({
    address: ctfAddr,
    abi: ctfAbi,
    functionName: "getCollectionId",
    args: conditionId ? [CTF_PARENT_COLLECTION_ZERO, conditionId, 2n] : undefined,
    query: { enabled: !!ctfAddr && !!conditionId && outcomeCount === 2n && ctfAbi.length > 0 },
  }) as { data: `0x${string}` | undefined };

  const { data: yesTokenId } = useReadContract({
    address: ctfAddr,
    abi: ctfAbi,
    functionName: "getPositionId",
    args: ammCollateralAddr && yesCollectionId ? [ammCollateralAddr, yesCollectionId] : undefined,
    query: {
      enabled: !!ctfAddr && !!ammCollateralAddr && !!yesCollectionId && ctfAbi.length > 0,
    },
  }) as { data: bigint | undefined };

  const { data: noTokenId } = useReadContract({
    address: ctfAddr,
    abi: ctfAbi,
    functionName: "getPositionId",
    args: ammCollateralAddr && noCollectionId ? [ammCollateralAddr, noCollectionId] : undefined,
    query: {
      enabled: !!ctfAddr && !!ammCollateralAddr && !!noCollectionId && ctfAbi.length > 0,
    },
  }) as { data: bigint | undefined };

  const { data: existingPool } = useReadContract({
    address: ammInfo?.address,
    abi: ammInfo?.abi ?? [],
    functionName: "getPool",
    args: conditionId ? [conditionId] : undefined,
    query: { enabled: !!ammInfo?.address && !!conditionId },
  }) as { data: { exists: boolean } | undefined };

  const publicClient = usePublicClient();
  const { writeContractAsync: writeErc20Modal } = useWriteContract();

  const handleCreate = async () => {
    if (!ammInfo?.address || !ammCollateralAddr || !conditionId || yesTokenId == null || noTokenId == null || !publicClient || !rail) {
      setError("Missing contracts or binary market data.");
      return;
    }
    if (outcomeCount !== 2n) {
      setError("This UI supports binary (2-outcome) pools only.");
      return;
    }
    if (existingPool?.exists) {
      setError("A pool already exists for this market on this AMM. Use Add liquidity instead.");
      return;
    }

    const iy = Number(initialYesProb);
    const pl = Number(percentageLocked);
    const probErr = lockedLiquidityValidationError(iy, pl);
    if (probErr) {
      setError(probErr);
      return;
    }

    setLoading(true);
    setError("");
    try {
      const bytecode = await publicClient.getBytecode({ address: ammCollateralAddr });
      if (!bytecode || bytecode === "0x") {
        setError(
          `This AMM uses collateral ${ammCollateralAddr}, which has no contract code on the connected network — ERC-20 transfers will always revert. On Arc Testnet, redeploy so the AMM uses Circle test USDC at 0x3600000000000000000000000000000000000000 (see packages/hardhat/deploy/00_deploy_your_contract.ts and ARC_USDC_ADDRESS), then yarn generate.`,
        );
        return;
      }

      const amount = parseUnits(collateralAmount, 6);

      const approveHash = await writeErc20Modal({
        address: ammCollateralAddr,
        abi: erc20Abi,
        functionName: "approve",
        args: [ammInfo.address, amount],
      });
      if (!approveHash) {
        throw new Error("Approve transaction did not return a hash.");
      }
      await publicClient.waitForTransactionReceipt({ hash: approveHash });

      if (rail === "EURC") {
        await writeAMMEurc({
          functionName: "createPool",
          args: [conditionId, yesTokenId, noTokenId, amount, iy, pl],
        });
      } else {
        await writeAMMUsdc({
          functionName: "createPool",
          args: [conditionId, yesTokenId, noTokenId, amount, iy, pl],
        });
      }
      onCreated(conditionId, rail);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const binaryOk = outcomeCount === 2n;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="rounded-3xl border border-border bg-card text-card-foreground shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto ring-1 ring-foreground/5">
        <div className="flex justify-between items-center p-5 border-b border-border">
          <h2 className="font-bold text-lg">💧 Create AMM Pool</h2>
          <Button variant="ghost" size="icon-sm" type="button" onClick={onClose} aria-label="Close modal">
            ✕
          </Button>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <label className="text-sm font-semibold block mb-1">1. Select registered market</label>
            <select
              className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none ring-ring/40 focus-visible:ring-2"
              value={selectedMarket}
              onChange={e => setSelectedMarket(e.target.value as `0x${string}`)}
            >
              <option value="">-- Choose a market --</option>
              {visibleMarkets.map(qId => (
                <option key={qId} value={qId}>
                  {qId.slice(0, 20)}…
                </option>
              ))}
            </select>
          </div>

          {selectedMarket && rail && (
            <div className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs">
              On-chain rail: <span className="font-semibold">{rail}</span> — pool will use the matching AMM (
              {rail === "EURC" ? "PredictionMarketAMM_EURC" : "PredictionMarketAMM_USDC"}).
            </div>
          )}

          {!binaryOk && selectedMarket && marketStruct?.exists && (
            <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 text-amber-900 dark:text-amber-100 text-xs p-3">
              Pool creation UI supports binary markets only (this market has {outcomeCount?.toString() ?? "?"} outcomes).
            </div>
          )}

          {existingPool?.exists && selectedMarket && binaryOk && (
            <div className="rounded-lg border border-destructive/40 bg-destructive/10 text-destructive text-xs p-3">
              This market already has a pool on this AMM ({rail}). Add liquidity on the main LP page instead of creating again.
            </div>
          )}

          {conditionId && binaryOk && (
            <div className="bg-muted/60 p-3 rounded-xl text-[10px] font-mono break-all space-y-1 border border-border">
              <p>
                <span className="text-primary font-bold">ConditionID:</span> {conditionId}
              </p>
              <p>
                <span className="text-secondary font-bold">YES TokenID:</span> {yesTokenId?.toString()}
              </p>
            </div>
          )}

          <div className="text-center text-xs text-muted-foreground uppercase tracking-wide border-t border-border pt-3">
            Pool parameters
          </div>

          {[
            { label: `Collateral amount (${rail ?? "…"})`, value: collateralAmount, set: setCollateralAmount, placeholder: "1000" },
            { label: "Initial YES probability (%)", value: initialYesProb, set: setInitialYesProb, placeholder: "50" },
            { label: "Percentage locked (%)", value: percentageLocked, set: setPercentageLocked, placeholder: "10" },
          ].map(({ label, value, set, placeholder }) => (
            <div key={label}>
              <label className="text-sm font-medium block mb-1">{label}</label>
              <input
                type="text"
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none ring-ring/40 focus-visible:ring-2"
                placeholder={placeholder}
                value={value}
                onChange={e => set(e.target.value)}
              />
            </div>
          ))}
          {error && (
            <div className="rounded-lg border border-destructive/40 bg-destructive/10 text-destructive text-xs p-2">{error}</div>
          )}
        </div>
        <div className="p-5 pt-0 flex gap-3">
          <Button onClick={onClose} variant="ghost" className="flex-1" type="button">
            Cancel
          </Button>
          <Button
            id="btn-confirm-create-pool"
            onClick={handleCreate}
            disabled={
              loading ||
              !conditionId ||
              !binaryOk ||
              !rail ||
              yesTokenId == null ||
              noTokenId == null ||
              existingPool?.exists
            }
            className="flex-1 gap-2"
            type="button"
          >
            {loading ? <Spinner className="size-4" /> : null}
            Create Pool
          </Button>
        </div>
      </div>
    </div>
  );
}

export default LiquidityProviderPage;
