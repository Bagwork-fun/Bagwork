import { type Address, type PublicClient, parseAbi, decodeEventLog } from "viem";

import type { SettlementRail } from "@/lib/marketRails";
import type { UserTradeEvent } from "@/lib/position-pnl";

export const TRADE_EVENTS_ABI = parseAbi([
  "event TokensBought(bytes32 indexed conditionId, address indexed buyer, uint256 outcome, uint256 tokenAmount, uint256 usdcPaid)",
  "event TokensSold(bytes32 indexed conditionId, address indexed seller, uint256 outcome, uint256 tokenAmount, uint256 usdcReceived)",
]);

export const PAYOUT_REDEMPTION_ABI = parseAbi([
  "event PayoutRedemption(address indexed redeemer, address indexed collateralToken, bytes32 indexed parentCollectionId, bytes32 conditionId, uint256[] indexSets, uint256 payout)",
]);

export type RedemptionEvent = {
  conditionId: `0x${string}`;
  payout: bigint;
  blockNumber: bigint;
  transactionHash: `0x${string}`;
};

async function fetchLogsForUser(
  publicClient: PublicClient,
  ammAddress: Address,
  user: Address,
  fromBlock: bigint,
  rail: SettlementRail,
): Promise<UserTradeEvent[]> {
  const toBlock = await publicClient.getBlockNumber();

  const [buys, sells] = await Promise.all([
    publicClient.getLogs({
      address: ammAddress,
      event: TRADE_EVENTS_ABI[0],
      args: { buyer: user },
      fromBlock,
      toBlock,
    }),
    publicClient.getLogs({
      address: ammAddress,
      event: TRADE_EVENTS_ABI[1],
      args: { seller: user },
      fromBlock,
      toBlock,
    }),
  ]);

  const out: UserTradeEvent[] = [];

  for (const log of buys) {
    const decoded = decodeEventLog({ abi: TRADE_EVENTS_ABI, data: log.data, topics: log.topics });
    if (decoded.eventName !== "TokensBought") continue;
    out.push({
      kind: "buy",
      conditionId: decoded.args.conditionId,
      outcome: Number(decoded.args.outcome),
      tokenAmount: decoded.args.tokenAmount,
      usdcAmount: decoded.args.usdcPaid,
      blockNumber: log.blockNumber ?? 0n,
      transactionHash: log.transactionHash ?? "0x0",
      rail,
    });
  }

  for (const log of sells) {
    const decoded = decodeEventLog({ abi: TRADE_EVENTS_ABI, data: log.data, topics: log.topics });
    if (decoded.eventName !== "TokensSold") continue;
    out.push({
      kind: "sell",
      conditionId: decoded.args.conditionId,
      outcome: Number(decoded.args.outcome),
      tokenAmount: decoded.args.tokenAmount,
      usdcAmount: decoded.args.usdcReceived,
      blockNumber: log.blockNumber ?? 0n,
      transactionHash: log.transactionHash ?? "0x0",
      rail,
    });
  }

  return out;
}

export async function fetchUserTrades(
  publicClient: PublicClient,
  user: Address,
  ammUsdc: Address | undefined,
  ammEurc: Address | undefined,
  fromBlock: bigint,
): Promise<UserTradeEvent[]> {
  const chunks: UserTradeEvent[] = [];
  if (ammUsdc) chunks.push(...(await fetchLogsForUser(publicClient, ammUsdc, user, fromBlock, "USDC")));
  if (ammEurc) chunks.push(...(await fetchLogsForUser(publicClient, ammEurc, user, fromBlock, "EURC")));
  return chunks.sort((a, b) => (a.blockNumber === b.blockNumber ? 0 : a.blockNumber < b.blockNumber ? -1 : 1));
}

export async function fetchUserRedemptions(
  publicClient: PublicClient,
  user: Address,
  ctfAddress: Address,
  fromBlock: bigint,
): Promise<RedemptionEvent[]> {
  const toBlock = await publicClient.getBlockNumber();
  const logs = await publicClient.getLogs({
    address: ctfAddress,
    event: PAYOUT_REDEMPTION_ABI[0],
    args: { redeemer: user },
    fromBlock,
    toBlock,
  });

  return logs.map(log => {
    const decoded = decodeEventLog({ abi: PAYOUT_REDEMPTION_ABI, data: log.data, topics: log.topics });
    if (decoded.eventName !== "PayoutRedemption") {
      return {
        conditionId: "0x0" as `0x${string}`,
        payout: 0n,
        blockNumber: log.blockNumber ?? 0n,
        transactionHash: log.transactionHash ?? "0x0",
      };
    }
    return {
      conditionId: decoded.args.conditionId,
      payout: decoded.args.payout,
      blockNumber: log.blockNumber ?? 0n,
      transactionHash: log.transactionHash ?? "0x0",
    };
  });
}
