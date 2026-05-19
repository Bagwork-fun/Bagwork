import { ipfsJsonGatewayUrls } from "@/lib/market-ipfs";

/** Server-side IPFS JSON fetch (no browser CORS). */
export async function fetchIpfsJsonFromGateways(cid: string): Promise<unknown | null> {
  for (const url of ipfsJsonGatewayUrls(cid)) {
    try {
      const res = await fetch(url, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) continue;
      return await res.json();
    } catch {
      continue;
    }
  }
  return null;
}
