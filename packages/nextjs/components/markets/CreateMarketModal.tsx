"use client";

import { useState } from "react";
import { keccak256, toBytes } from "viem";
import { useScaffoldWriteContract } from "~~/hooks/scaffold-eth";
import { settlementRailEnumArg, type SettlementRail } from "@/lib/marketRails";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

interface MarketMetadata {
  title: string;
  description: string;
  outcomes: string[];
  resolutionTime: number;
  category: string;
  settlementAsset: SettlementRail;
  imageUrl?: string;
  tags?: string[];
}

interface Props {
  onClose: () => void;
  onCreated: () => void;
}

const CATEGORIES = ["Sports", "Crypto", "Politics", "Science", "Entertainment", "Other"];

export function CreateMarketModal({ onClose, onCreated }: Props) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("Sports");
  const [settlementRail, setSettlementRail] = useState<SettlementRail>("USDC");
  const [outcomes, setOutcomes] = useState(["Yes", "No"]);
  const [resolutionDate, setResolutionDate] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [step, setStep] = useState<"form" | "uploading" | "creating" | "done">("form");
  const [error, setError] = useState<string | null>(null);
  const [cid, setCid] = useState<string | null>(null);

  const { writeContractAsync } = useScaffoldWriteContract({ contractName: "MarketRegistry" });

  const addOutcome = () => setOutcomes(prev => [...prev, ""]);
  const removeOutcome = (i: number) =>
    setOutcomes(prev => prev.filter((_, idx) => idx !== i));
  const updateOutcome = (i: number, v: string) =>
    setOutcomes(prev => prev.map((o, idx) => (idx === i ? v : o)));

  const isValid =
    title.trim().length > 0 &&
    description.trim().length > 0 &&
    outcomes.length >= 2 &&
    outcomes.every(o => o.trim().length > 0) &&
    resolutionDate.length > 0;

  const handleCreate = async () => {
    if (!isValid) return;
    setError(null);

    const resolutionTime = Math.floor(new Date(resolutionDate).getTime() / 1000);
    if (resolutionTime <= Math.floor(Date.now() / 1000)) {
      setError("Resolution time must be in the future.");
      return;
    }

    const metadata: MarketMetadata = {
      title: title.trim(),
      description: description.trim(),
      outcomes: outcomes.map(o => o.trim()),
      resolutionTime,
      category,
      settlementAsset: settlementRail,
      ...(imageUrl.trim() && { imageUrl: imageUrl.trim() }),
    };

    // ── Step 1: Upload to IPFS via Pinata ──────────────────────────────────
    setStep("uploading");
    let ipfsCid: string;
    try {
      ipfsCid = await uploadToIPFS(metadata);
      setCid(ipfsCid);
    } catch (e) {
      setError(`IPFS upload failed: ${e instanceof Error ? e.message : String(e)}`);
      setStep("form");
      return;
    }

    // ── Step 2: Create market on-chain ──────────────────────────────────────
    setStep("creating");
    try {
      await writeContractAsync({
        functionName: "createMarket",
        args: [ipfsCid, BigInt(outcomes.length), BigInt(resolutionTime), settlementRailEnumArg(settlementRail)],
      });

      // Cache CID locally so MarketCard can fetch IPFS metadata
      const questionId = keccak256ForCid(ipfsCid);
      if (typeof window !== "undefined") {
        localStorage.setItem(`market_cid_${questionId}`, ipfsCid);
      }

      setStep("done");
      onCreated();
    } catch (e) {
      setError(`Contract call failed: ${e instanceof Error ? e.message : String(e)}`);
      setStep("form");
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="rounded-3xl border border-border bg-card text-card-foreground shadow-2xl w-full max-w-xl max-h-[90vh] overflow-y-auto ring-1 ring-foreground/5">
        {/* ── Header ──────────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between p-6 border-b border-border">
          <h2 className="text-xl font-bold">🔮 Create Prediction Market</h2>
          <Button id="btn-close-modal" variant="ghost" size="icon-sm" type="button" onClick={onClose} aria-label="Close">
            ✕
          </Button>
        </div>

        {/* ── Body ────────────────────────────────────────────────────────── */}
        <div className="p-6 space-y-5">
          {step === "done" ? (
            <div className="text-center py-8 space-y-3">
              <div className="text-6xl">✅</div>
              <p className="text-lg font-semibold">Market Created!</p>
              <p className="text-sm text-muted-foreground break-all">IPFS CID: {cid}</p>
              <Button onClick={onClose} type="button">
                View Markets
              </Button>
            </div>
          ) : (
            <>
              {/* Title */}
              <div>
                <label className="text-sm font-semibold block mb-1">Market Title *</label>
                <input
                  id="input-market-title"
                  type="text"
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none ring-ring/40 focus-visible:ring-2"
                  placeholder="Will the green car win the race?"
                  value={title}
                  onChange={e => setTitle(e.target.value)}
                  maxLength={256}
                  disabled={step !== "form"}
                />
              </div>

              {/* Description / Resolution Criteria */}
              <div>
                <div className="flex flex-wrap items-baseline justify-between gap-2 mb-1">
                  <label className="text-sm font-semibold">Resolution Criteria *</label>
                  <span className="text-xs text-muted-foreground">Gemini AI reads this to resolve</span>
                </div>
                <textarea
                  id="input-market-description"
                  className="flex min-h-28 w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none ring-ring/40 focus-visible:ring-2"
                  placeholder="Describe exactly when and how this market resolves. Be specific about sources."
                  value={description}
                  onChange={e => setDescription(e.target.value)}
                  maxLength={4096}
                  disabled={step !== "form"}
                />
              </div>

              {/* Category */}
              <div>
                <label className="text-sm font-semibold block mb-1">Category</label>
                <select
                  id="select-market-category"
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none ring-ring/40 focus-visible:ring-2"
                  value={category}
                  onChange={e => setCategory(e.target.value)}
                  disabled={step !== "form"}
                >
                  {CATEGORIES.map(c => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              </div>

              {/* Settlement currency */}
              <div>
                <label className="text-sm font-semibold block mb-1">Settlement currency</label>
                <p className="text-xs text-muted-foreground mb-2">
                  Liquidity and payouts use this collateral rail on-chain (USDC vs EURC pool).
                </p>
                <select
                  id="select-settlement-rail"
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none ring-ring/40 focus-visible:ring-2"
                  value={settlementRail}
                  onChange={e => setSettlementRail(e.target.value as SettlementRail)}
                  disabled={step !== "form"}
                >
                  <option value="USDC">USDC</option>
                  <option value="EURC">EURC</option>
                </select>
              </div>

              {/* Outcomes */}
              <div>
                <div className="flex flex-wrap items-baseline justify-between gap-2 mb-1">
                  <label className="text-sm font-semibold">Outcomes *</label>
                  <span className="text-xs text-muted-foreground">Min 2</span>
                </div>
                <div className="space-y-2">
                  {outcomes.map((o, i) => (
                    <div key={i} className="flex gap-2 items-center">
                      <span className="text-xs text-muted-foreground w-6 text-right">[{i}]</span>
                      <input
                        type="text"
                        className="flex h-9 flex-1 min-w-0 rounded-md border border-input bg-background px-3 text-sm outline-none ring-ring/40 focus-visible:ring-2"
                        placeholder={i === 0 ? "Yes" : "No"}
                        value={o}
                        onChange={e => updateOutcome(i, e.target.value)}
                        disabled={step !== "form"}
                      />
                      {outcomes.length > 2 && (
                        <Button variant="ghost" size="icon-sm" type="button" onClick={() => removeOutcome(i)} disabled={step !== "form"}>
                          ✕
                        </Button>
                      )}
                    </div>
                  ))}
                  {outcomes.length < 8 && (
                    <Button variant="ghost" size="xs" type="button" onClick={addOutcome} disabled={step !== "form"}>
                      + Add outcome
                    </Button>
                  )}
                </div>
              </div>

              {/* Resolution Time */}
              <div>
                <div className="flex flex-wrap items-baseline justify-between gap-2 mb-1">
                  <label className="text-sm font-semibold">Resolution Date & Time *</label>
                  <span className="text-xs text-muted-foreground">CRE triggers Gemini at this time</span>
                </div>
                <input
                  id="input-resolution-time"
                  type="datetime-local"
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none ring-ring/40 focus-visible:ring-2"
                  value={resolutionDate}
                  onChange={e => setResolutionDate(e.target.value)}
                  disabled={step !== "form"}
                />
              </div>

              {/* Image URL (optional) */}
              <div>
                <div className="flex flex-wrap items-baseline justify-between gap-2 mb-1">
                  <label className="text-sm font-semibold">Banner Image URL</label>
                  <span className="text-xs text-muted-foreground">Optional</span>
                </div>
                <input
                  type="url"
                  className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none ring-ring/40 focus-visible:ring-2"
                  placeholder="https://..."
                  value={imageUrl}
                  onChange={e => setImageUrl(e.target.value)}
                  disabled={step !== "form"}
                />
              </div>

              {/* IPFS note */}
              <div className="rounded-lg border border-sky-500/30 bg-sky-500/10 text-sm p-3 text-foreground">
                <span>
                  📌 Metadata is stored on IPFS. Only the CID is written on-chain. Ensure your Pinata API key is set in{" "}
                  <code className="rounded bg-muted px-1 py-0.5 text-xs">.env.local</code>.
                </span>
              </div>

              {error && (
                <div className="rounded-lg border border-destructive/40 bg-destructive/10 text-sm p-3 text-destructive">
                  ⚠ {error}
                </div>
              )}

              {/* Progress */}
              {step !== "form" && (
                <div className="flex items-center gap-3 text-sm text-muted-foreground">
                  <Spinner className="size-4 shrink-0" />
                  {step === "uploading" && "Uploading metadata to IPFS..."}
                  {step === "creating" && "Sending transaction..."}
                </div>
              )}
            </>
          )}
        </div>

        {/* ── Footer ──────────────────────────────────────────────────────── */}
        {step === "form" && (
          <div className="p-6 pt-0 flex gap-3">
            <Button onClick={onClose} variant="ghost" className="flex-1" type="button">
              Cancel
            </Button>
            <Button id="btn-submit-create-market" onClick={handleCreate} className="flex-1" disabled={!isValid} type="button">
              Create Market
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────────

async function uploadToIPFS(metadata: MarketMetadata): Promise<string> {
  const pinataApiKey = process.env.NEXT_PUBLIC_PINATA_API_KEY;
  const pinataSecret = process.env.NEXT_PUBLIC_PINATA_SECRET_KEY;

  if (!pinataApiKey || !pinataSecret) {
    // Fallback: use public w3s.link or nft.storage
    throw new Error(
      "NEXT_PUBLIC_PINATA_API_KEY and NEXT_PUBLIC_PINATA_SECRET_KEY must be set in .env.local"
    );
  }

  const res = await fetch("https://api.pinata.cloud/pinning/pinJSONToIPFS", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      pinata_api_key: pinataApiKey,
      pinata_secret_api_key: pinataSecret,
    },
    body: JSON.stringify({ pinataContent: metadata }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Pinata error ${res.status}: ${text}`);
  }

  const json = await res.json();
  return json.IpfsHash as string;
}

/** Mirrors Solidity: keccak256(abi.encodePacked(ipfsCid)) */
function keccak256ForCid(ipfsCid: string): string {
  return keccak256(toBytes(ipfsCid));
}
