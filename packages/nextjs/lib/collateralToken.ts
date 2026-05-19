import type { Abi } from "abitype";
import type { Address } from "viem";
import { collateralAbiHasMint } from "./marketRails";

/**
 * Canonical Circle test + widely used official test stables.
 * The LP UI ships MockUSDC/MockEURC ABIs (including `mint`) at these addresses on some networks;
 * real tokens have no mint — we hide faucet buttons when the live collateral is one of these.
 */
export const NON_MINTABLE_COLLATERAL_ADDRESSES = new Set(
  [
    "0x3600000000000000000000000000000000000000", // Circle test USDC (Arc testnet & peers)
    "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a", // Circle test EURC
    "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238", // Sepolia USDC (public test token)
  ].map(a => a.toLowerCase()),
);

/** Show dev "mint" actions only for real mock deployments, not official Circle / USDC test tokens. */
export function showMockMintControls(tokenAddress: Address | undefined, deploymentAbi: Abi): boolean {
  if (!tokenAddress) return false;
  if (NON_MINTABLE_COLLATERAL_ADDRESSES.has(tokenAddress.toLowerCase())) return false;
  return collateralAbiHasMint(deploymentAbi);
}
