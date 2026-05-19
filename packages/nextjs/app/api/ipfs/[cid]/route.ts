import { NextResponse } from "next/server";

import { fetchIpfsJsonFromGateways } from "@/lib/market-ipfs-server";

type RouteContext = { params: Promise<{ cid: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const { cid } = await context.params;
  const trimmed = cid?.trim();
  if (!trimmed) {
    return NextResponse.json({ error: "Missing CID" }, { status: 400 });
  }

  const data = await fetchIpfsJsonFromGateways(trimmed);
  if (data == null) {
    return NextResponse.json({ error: "IPFS metadata not found" }, { status: 404 });
  }

  return NextResponse.json(data, {
    headers: {
      "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600",
    },
  });
}
