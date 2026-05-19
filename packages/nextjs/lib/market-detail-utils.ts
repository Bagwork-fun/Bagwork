/** Pick the earliest log by block number (handles reversed / merged event lists). */
export function pickEarliestLog<T extends { blockNumber?: bigint }>(
  logs: T[] | undefined | null,
): T | undefined {
  if (!logs?.length) return undefined;
  return logs.reduce((a, b) =>
    Number(a.blockNumber ?? 0n) <= Number(b.blockNumber ?? 0n) ? a : b,
  );
}

/**
 * Lower bound block for “last ~24h” trade volume — intersected with market creation in the caller.
 */
export function approxVolumeWindowBlocks(chainId: number | undefined): bigint {
  if (chainId === 5_042_002) return 86_400n; // Arc testnet ~1s blocks
  if (chainId === 31_337 || chainId === 31_338 || chainId === 1_337) return 50_000n;
  return 7_200n; // ~24h @ 12s
}

export function volumeFromBlock(
  latest: bigint,
  creationBlock: bigint | undefined,
  chainId: number | undefined,
): bigint {
  const window = approxVolumeWindowBlocks(chainId);
  const approxOneDayAgo = latest > window ? latest - window : 0n;
  if (creationBlock != null && creationBlock > approxOneDayAgo) return creationBlock;
  return approxOneDayAgo;
}
