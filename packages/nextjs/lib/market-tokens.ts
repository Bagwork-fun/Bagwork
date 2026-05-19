import { encodePacked, keccak256, type Address } from "viem";

/** `parentCollectionId` for root CTF positions (see `ConditionalTokens.splitPosition`). */
export const CTF_PARENT_COLLECTION_ZERO =
  "0x0000000000000000000000000000000000000000000000000000000000000000" as const;

/**
 * Validates LP seed parameters for `PredictionMarketAMM.createPool`.
 * The contract moves `lockedYes` / `lockedNo` outcome tokens to the LP; each must be ≤ minted amount (`usdcAmount`).
 */
export function lockedLiquidityValidationError(
  initialYesProbabilityPct: number,
  percentageLockedPct: number,
): string | null {
  if (!Number.isFinite(initialYesProbabilityPct) || !Number.isFinite(percentageLockedPct)) {
    return "Invalid probability inputs.";
  }
  if (
    initialYesProbabilityPct < 1 ||
    initialYesProbabilityPct > 99 ||
    percentageLockedPct < 1 ||
    percentageLockedPct > 99
  ) {
    return "YES probability and locked % must each be between 1 and 99.";
  }
  const lockedYesNumerator = initialYesProbabilityPct * percentageLockedPct * 2;
  const lockedNoNumerator = (100 - initialYesProbabilityPct) * percentageLockedPct * 2;
  if (lockedYesNumerator > 10000 || lockedNoNumerator > 10000) {
    return "This YES % and locked % would move more outcome tokens than were minted. Lower one of them (need YES%×locked%×2≤10000 and (100−YES)%×locked%×2≤10000).";
  }
  return null;
}

export function computeConditionId(
  adapterAddress: Address | undefined,
  questionId: `0x${string}`,
  outcomeSlotCount: bigint | undefined,
): `0x${string}` | undefined {
  if (!adapterAddress || outcomeSlotCount == null) return undefined;
  return keccak256(encodePacked(["address", "bytes32", "uint256"], [adapterAddress, questionId, outcomeSlotCount]));
}

export function computeOutcomeTokenIds(
  collateralAddress: Address | undefined,
  conditionId: `0x${string}` | undefined,
): { yesTokenId: bigint | undefined; noTokenId: bigint | undefined } {
  if (!collateralAddress || !conditionId) return { yesTokenId: undefined, noTokenId: undefined };
  const innerYes = keccak256(encodePacked(["bytes32", "uint256"], [conditionId, 1n]));
  const innerNo = keccak256(encodePacked(["bytes32", "uint256"], [conditionId, 2n]));
  const yesTokenId = BigInt(keccak256(encodePacked(["address", "bytes32"], [collateralAddress, innerYes])));
  const noTokenId = BigInt(keccak256(encodePacked(["address", "bytes32"], [collateralAddress, innerNo])));
  return { yesTokenId, noTokenId };
}
