import type { Abi } from "viem";
import type { GenericContractsDeclaration } from "~~/utils/scaffold-eth/contract";

import aiCTFLocalhost from "../../hardhat/deployments/localhost/AiCTFAdapter.json";
import autoFinalizerLocalhost from "../../hardhat/deployments/localhost/AutoFinalizerUpkeep.json";
import conditionalLocalhost from "../../hardhat/deployments/localhost/ConditionalTokens.json";
import mockEurcLocalhost from "../../hardhat/deployments/localhost/MockEURC.json";
import mockUsdcLocalhost from "../../hardhat/deployments/localhost/MockUSDC.json";
import marketRegistryLocalhost from "../../hardhat/deployments/localhost/MarketRegistry.json";
import predictionMarketAmmEurcLocalhost from "../../hardhat/deployments/localhost/PredictionMarketAMM_EURC.json";
import predictionMarketAmmUsdcLocalhost from "../../hardhat/deployments/localhost/PredictionMarketAMM_USDC.json";
import marketRegistrySepolia from "../../hardhat/deployments/sepolia/MarketRegistry.json";
import predictionMarketAmmSepolia from "../../hardhat/deployments/sepolia/PredictionMarketAMM.json";

/** Until `yarn deploy:arcTestnet` updates `deployedContracts.ts`, these placeholders satisfy typings for chain 5042002. */
const ARC_PLACEHOLDER = "0x0000000000000000000000000000000000000000" as const;
/** Circle USDC / EURC on Arc Testnet (same canonical test addresses as other Circle testnets). */
const CIRCLE_ARC_USDC = "0x3600000000000000000000000000000000000000" as const;
const CIRCLE_ARC_EURC = "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a" as const;

/**
 * Overlays for chains that need ABIs/addresses merged before or after codegen.
 *
 * - **5042002 (Arc):** placeholder contract addresses until Hardhat deploy writes `deployments/arcTestnet` and regenerates `deployedContracts.ts`.
 * - **11155111 (Sepolia):** legacy overlay for dual USDC/EURC AMM naming.
 */
const externalContracts = {
  5042002: {
    AiCTFAdapter: {
      address: ARC_PLACEHOLDER,
      abi: aiCTFLocalhost.abi as Abi,
    },
    AutoFinalizerUpkeep: {
      address: ARC_PLACEHOLDER,
      abi: autoFinalizerLocalhost.abi as Abi,
    },
    ConditionalTokens: {
      address: ARC_PLACEHOLDER,
      abi: conditionalLocalhost.abi as Abi,
    },
    MarketRegistry: {
      address: ARC_PLACEHOLDER,
      abi: marketRegistryLocalhost.abi as Abi,
    },
    MockUSDC: {
      address: CIRCLE_ARC_USDC,
      abi: mockUsdcLocalhost.abi as Abi,
    },
    MockEURC: {
      address: CIRCLE_ARC_EURC,
      abi: mockEurcLocalhost.abi as Abi,
    },
    PredictionMarketAMM_USDC: {
      address: ARC_PLACEHOLDER,
      abi: predictionMarketAmmUsdcLocalhost.abi as Abi,
    },
    PredictionMarketAMM_EURC: {
      address: ARC_PLACEHOLDER,
      abi: predictionMarketAmmEurcLocalhost.abi as Abi,
    },
  },
  11155111: {
    MarketRegistry: {
      address: marketRegistrySepolia.address as `0x${string}`,
      abi: marketRegistryLocalhost.abi as Abi,
    },
    PredictionMarketAMM_USDC: {
      address: predictionMarketAmmSepolia.address as `0x${string}`,
      abi: predictionMarketAmmUsdcLocalhost.abi as Abi,
    },
    PredictionMarketAMM_EURC: {
      address: "0x0000000000000000000000000000000000000000",
      abi: predictionMarketAmmEurcLocalhost.abi as Abi,
    },
    MockEURC: {
      address: "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a",
      abi: mockEurcLocalhost.abi as Abi,
    },
  },
} satisfies GenericContractsDeclaration;

export default externalContracts;
