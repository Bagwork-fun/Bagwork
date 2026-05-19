/**
 * Market metadata lives on IPFS; the CID is only in MarketCreated logs (or localStorage cache).
 * Event scans must start from a block that exists on the current chain (local Hardhat tip ≪ Sepolia).
 */

const SEPOLIA_MARKET_LOG_HINT = 10_859_626n;

export function marketRegistryLogsFromBlock(chainId: number | undefined): bigint {
  const raw =
    typeof process !== "undefined" ? process.env.NEXT_PUBLIC_MARKET_EVENTS_FROM_BLOCK : undefined;
  if (raw?.trim() && /^\d+$/.test(raw.trim())) return BigInt(raw.trim());

  if (chainId === 31337 || chainId === 31338 || chainId === 1337) return 0n;
  if (chainId === 11_155_111) return SEPOLIA_MARKET_LOG_HINT;
  if (chainId === 5_042_002) return 0n;
  return 0n;
}

/** IPFS gateways — try Pinata + Web3.Storage first (Pinata JSON pins resolve reliably). */
export function ipfsJsonGatewayUrls(cid: string): string[] {
  const c = cid.trim();
  if (!c) return [];
  return [
    `https://gateway.pinata.cloud/ipfs/${c}`,
    `https://${c}.ipfs.dweb.link/`,
    `https://w3s.link/ipfs/${c}`,
    `https://${c}.ipfs.w3s.link/`,
    `https://ipfs.io/ipfs/${c}`,
    `https://cloudflare-ipfs.com/ipfs/${c}`,
  ];
}

export async function fetchIpfsJson<T>(cid: string): Promise<T | null> {
  for (const url of ipfsJsonGatewayUrls(cid)) {
    try {
      const res = await fetch(url);
      if (!res.ok) continue;
      return (await res.json()) as T;
    } catch {
      continue;
    }
  }
  return null;
}

/** Read ipfsCid from a decoded MarketCreated log (viem may use named args or tuple). */
export function parseMarketCreatedIpfsCid(creationLog: unknown): string | null {
  if (creationLog == null || typeof creationLog !== "object") return null;
  const rec = creationLog as Record<string, unknown>;
  const args = rec.args;
  if (args == null) return null;

  if (typeof args === "object" && !Array.isArray(args)) {
    const named = (args as Record<string, unknown>).ipfsCid;
    if (typeof named === "string" && named.length > 0) return named;
  }
  if (Array.isArray(args) && typeof args[1] === "string" && args[1].length > 0) return args[1];
  return null;
}
