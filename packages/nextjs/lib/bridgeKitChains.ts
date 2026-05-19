import scaffoldConfig from "~~/scaffold.config";

/**
 * Bridge Kit chain name strings (Circle CCTP v2). Keep in sync with:
 * https://developers.circle.com/bridge-kit/references/supported-blockchains
 */
export const BRIDGE_KIT_CHAIN_NAMES: Record<number, string> = {
  5042002: "Arc_Testnet",
  11155111: "Ethereum_Sepolia",
  84532: "Base_Sepolia",
  421614: "Arbitrum_Sepolia",
  11155420: "Optimism_Sepolia",
};

export type BridgeSourceOption = {
  id: string;
  label: string;
  bridgeKitChain: string;
  chainId: number;
};

/** Typical testnets to source USDC from before using it on `targetNetworks[0]`. */
export const BRIDGE_SOURCE_OPTIONS: BridgeSourceOption[] = [
  { id: "base-sepolia", label: "Base Sepolia", bridgeKitChain: "Base_Sepolia", chainId: 84532 },
  { id: "arb-sepolia", label: "Arbitrum Sepolia", bridgeKitChain: "Arbitrum_Sepolia", chainId: 421614 },
  { id: "eth-sepolia", label: "Ethereum Sepolia", bridgeKitChain: "Ethereum_Sepolia", chainId: 11155111 },
];

export function destinationBridgeKitChain(): string | undefined {
  const id = scaffoldConfig.targetNetworks[0]?.id;
  return id != null ? BRIDGE_KIT_CHAIN_NAMES[id] : undefined;
}

export function targetChainId(): number | undefined {
  return scaffoldConfig.targetNetworks[0]?.id;
}

export function isLocalhostTarget(): boolean {
  const id = targetChainId();
  return id === 31337 || id === 1337;
}
