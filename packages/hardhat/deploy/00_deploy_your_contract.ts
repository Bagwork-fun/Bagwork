import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import { ethers } from "hardhat";
import * as fs from "fs";

/** Official Circle test USDC / EURC (Sepolia, Arc Testnet, and other Circle test envs). */
const DEFAULT_CIRCLE_USDC = "0x3600000000000000000000000000000000000000";
const DEFAULT_CIRCLE_EURC = "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a";

/** Chainlink CRE on Arc Testnet — https://docs.chain.link/cre/ */
const ARC_CRE_CHAIN_SELECTOR = "arc-testnet";
const ARC_CRE_FORWARDER = "0x6E9EE680ef59ef64Aa8C7371279c27E496b5eDc1";
const SEPOLIA_CRE_FORWARDER = "0x15fC6ae953E024d975e77382eEeC56A9101f9F88";

/**
 * Deployment sequence for the Polymarket-style CTF prediction market system:
 *
 *  1. MockUSDC (+ MockEURC on localhost / hardhat only), or Circle test USDC/EURC on Arc & when USE_REAL_USDC=true
 *  2. ConditionalTokens — Gnosis CTF (shared, immutable)
 *  3. AiCTFAdapter      — oracle adapter (CRE forwarder + dispute window + multisig)
 *  4. MarketRegistry
 *  5. PredictionMarketAMM_USDC / PredictionMarketAMM_EURC
 *
 * Arc Testnet: `yarn deploy:arcTestnet`. Use `yarn deploy:arcTestnet:reset` to clear deployment records and redeploy
 * everything (required after collateral/network mistakes — hardhat-deploy skips unchanged contracts otherwise).
 */
const deploy: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();
  const { deploy } = hre.deployments;
  const isLocalhost = hre.network.name === "localhost" || hre.network.name === "hardhat";
  const chainId = Number((await hre.ethers.provider.getNetwork()).chainId);
  const isArcTestnet = chainId === 5_042_002 || hre.network.name === "arcTestnet";

  console.log(`\n🚀 Deploying to ${hre.network.name} (chainId ${chainId}) as ${deployer}\n`);

  let usdcAddress: string;
  let eurcAddress: string;

  const useRealUsdc = process.env.USE_REAL_USDC === "true";
  const useCircleCollateral = useRealUsdc || isArcTestnet;

  // -----------------------------------------------------------------------
  // 1. Collateral ERC-20s (USDC + EURC rails)
  // -----------------------------------------------------------------------
  if (isLocalhost) {
    console.log("📦 Deploying MockUSDC + MockEURC (mintable)...");
    const mockUsdc = await deploy("MockUSDC", {
      from: deployer,
      args: [],
      log: true,
      autoMine: true,
    });
    usdcAddress = mockUsdc.address;

    const mockEurc = await deploy("MockEURC", {
      from: deployer,
      args: [],
      log: true,
      autoMine: true,
    });
    eurcAddress = mockEurc.address;

    const usdc = await hre.ethers.getContractAt("MockUSDC", usdcAddress);
    const eurc = await hre.ethers.getContractAt("MockEURC", eurcAddress);
    await usdc.mint(deployer, ethers.parseUnits("100000", 6));
    await eurc.mint(deployer, ethers.parseUnits("100000", 6));
    console.log(`   MockUSDC: ${usdcAddress}`);
    console.log(`   MockEURC: ${eurcAddress}`);
    console.log("   ✅ Minted 100,000 of each stablecoin to deployer\n");
  } else if (useCircleCollateral) {
    // Arc: never fall through to SEPOLIA_* env vars (common .env mistake breaks pool collateral).
    if (isArcTestnet) {
      usdcAddress = process.env.ARC_USDC_ADDRESS ?? DEFAULT_CIRCLE_USDC;
      eurcAddress = process.env.ARC_EURC_ADDRESS ?? DEFAULT_CIRCLE_EURC;
    } else {
      usdcAddress = process.env.SEPOLIA_USDC_ADDRESS ?? process.env.ARC_USDC_ADDRESS ?? DEFAULT_CIRCLE_USDC;
      eurcAddress = process.env.SEPOLIA_EURC_ADDRESS ?? process.env.ARC_EURC_ADDRESS ?? DEFAULT_CIRCLE_EURC;
    }
    console.log(`   Using Circle test USDC at: ${usdcAddress}`);
    console.log(`   Using Circle test EURC at: ${eurcAddress}\n`);

    if (isArcTestnet) {
      const usdcCode = await hre.ethers.provider.getCode(usdcAddress);
      const eurcCode = await hre.ethers.provider.getCode(eurcAddress);
      if (usdcCode === "0x") {
        throw new Error(
          `[Arc] No contract bytecode at USDC ${usdcAddress}. On Arc Testnet use Circle USDC at ${DEFAULT_CIRCLE_USDC} (export ARC_USDC_ADDRESS if overriding).`,
        );
      }
      if (eurcCode === "0x") {
        throw new Error(
          `[Arc] No contract bytecode at EURC ${eurcAddress}. On Arc Testnet use Circle EURC at ${DEFAULT_CIRCLE_EURC} (export ARC_EURC_ADDRESS if overriding).`,
        );
      }
    }

    const mockUsdcArtifact = await hre.deployments.getArtifact("MockUSDC");
    await hre.deployments.save("MockUSDC", {
      address: usdcAddress,
      abi: mockUsdcArtifact.abi,
    });
    const mockEurcArtifact = await hre.deployments.getArtifact("MockEURC");
    await hre.deployments.save("MockEURC", {
      address: eurcAddress,
      abi: mockEurcArtifact.abi,
    });
  } else {
    console.log("📦 Deploying MockUSDC + MockEURC on network (mint disabled after deploy — use faucet flows if needed)...");
    const mockUsdc = await deploy("MockUSDC", {
      from: deployer,
      args: [],
      log: true,
      autoMine: true,
    });
    const mockEurc = await deploy("MockEURC", {
      from: deployer,
      args: [],
      log: true,
      autoMine: true,
    });
    usdcAddress = mockUsdc.address;
    eurcAddress = mockEurc.address;
    console.log(`   MockUSDC: ${usdcAddress}`);
    console.log(`   MockEURC: ${eurcAddress}\n`);
  }

  // -----------------------------------------------------------------------
  // 2. ConditionalTokens (Gnosis CTF)
  // -----------------------------------------------------------------------
  console.log("📦 Deploying ConditionalTokens...");
  const ctfDeploy = await deploy("ConditionalTokens", {
    from: deployer,
    args: [],
    log: true,
    autoMine: true,
  });
  console.log(`   ConditionalTokens deployed at: ${ctfDeploy.address}\n`);

  // -----------------------------------------------------------------------
  // 3. AiCTFAdapter
  // -----------------------------------------------------------------------
  const creForwarder = isLocalhost
    ? deployer
    : isArcTestnet
      ? process.env.ARC_CRE_FORWARDER_ADDRESS ?? ARC_CRE_FORWARDER
      : process.env.CRE_FORWARDER_ADDRESS ?? SEPOLIA_CRE_FORWARDER;

  const disputeWindow = isLocalhost ? 60 : 2 * 60 * 60;

  const multisigSigners: string[] = isLocalhost
    ? [deployer]
    : (process.env.MULTISIG_SIGNERS ?? "").split(",").filter(Boolean);
  const multisigThreshold =
    multisigSigners.length > 0
      ? Math.min(Number(process.env.MULTISIG_THRESHOLD) || 1, multisigSigners.length)
      : 0;

  console.log("📦 Deploying AiCTFAdapter...");
  console.log(`   CRE chain selector:  ${process.env.CRE_CHAIN_SELECTOR_NAME ?? (isArcTestnet ? ARC_CRE_CHAIN_SELECTOR : "ethereum-testnet-sepolia")}`);
  console.log(`   CRE Forwarder:       ${creForwarder}`);
  console.log(`   Dispute window:      ${disputeWindow}s`);
  console.log(`   Multisig signers:    ${multisigSigners.join(", ") || "(none)"}`);
  console.log(`   Multisig threshold:  ${multisigThreshold}`);

  const adapterDeploy = await deploy("AiCTFAdapter", {
    from: deployer,
    args: [ctfDeploy.address, creForwarder, disputeWindow, multisigSigners, multisigThreshold],
    log: true,
    autoMine: true,
  });
  console.log(`   AiCTFAdapter deployed at: ${adapterDeploy.address}\n`);

  // -----------------------------------------------------------------------
  // 4. MarketRegistry
  // -----------------------------------------------------------------------
  console.log("📦 Deploying MarketRegistry...");
  const registryDeploy = await deploy("MarketRegistry", {
    from: deployer,
    args: [adapterDeploy.address],
    log: true,
    autoMine: true,
  });
  console.log(`   MarketRegistry deployed at: ${registryDeploy.address}\n`);

  const adapter = await hre.ethers.getContractAt("AiCTFAdapter", adapterDeploy.address);
  const setRegistryTx = await adapter.setRegistry(registryDeploy.address);
  await setRegistryTx.wait();
  console.log(`   ✅ AiCTFAdapter.registry set to MarketRegistry\n`);

  // -----------------------------------------------------------------------
  // 5. Dual PredictionMarketAMM (same bytecode, distinct deployment ids)
  // -----------------------------------------------------------------------
  console.log("📦 Deploying PredictionMarketAMM_USDC...");
  const ammUsdcDeploy = await deploy("PredictionMarketAMM_USDC", {
    contract: "PredictionMarketAMM",
    from: deployer,
    args: [ctfDeploy.address, usdcAddress],
    log: true,
    autoMine: true,
  });

  console.log("📦 Deploying PredictionMarketAMM_EURC...");
  const ammEurcDeploy = await deploy("PredictionMarketAMM_EURC", {
    contract: "PredictionMarketAMM",
    from: deployer,
    args: [ctfDeploy.address, eurcAddress],
    log: true,
    autoMine: true,
  });

  console.log(`   PredictionMarketAMM_USDC: ${ammUsdcDeploy.address}`);
  console.log(`   PredictionMarketAMM_EURC: ${ammEurcDeploy.address}\n`);

  // -----------------------------------------------------------------------
  // 5.5 AutoFinalizerUpkeep
  // -----------------------------------------------------------------------
  console.log("📦 Deploying AutoFinalizerUpkeep...");
  const upkeepDeploy = await deploy("AutoFinalizerUpkeep", {
    from: deployer,
    args: [adapterDeploy.address, registryDeploy.address],
    log: true,
    autoMine: true,
  });
  console.log(`   AutoFinalizerUpkeep deployed at: ${upkeepDeploy.address}\n`);

  const adapterContract = await hre.ethers.getContractAt("AiCTFAdapter", adapterDeploy.address);
  await adapterContract.setUpkeepFinalizer(upkeepDeploy.address);
  console.log(`   AiCTFAdapter.upkeepFinalizer → ${upkeepDeploy.address}\n`);

  // -----------------------------------------------------------------------
  // 6. Write CRE job config & Sync Secrets
  // -----------------------------------------------------------------------
  const creDir = `${__dirname}/../../cre-jobs/prediction-market-job`;
  const creBaseDir = `${__dirname}/../../cre-jobs`;

  const creChainSelectorName =
    process.env.CRE_CHAIN_SELECTOR_NAME ?? (isArcTestnet ? ARC_CRE_CHAIN_SELECTOR : "ethereum-testnet-sepolia");
  const creRpcUrl = isArcTestnet
    ? process.env.ARC_TESTNET_RPC_URL ?? "https://rpc.testnet.arc.network"
    : process.env.SEPOLIA_RPC_URL ?? "https://0xrpc.io/sep";

  const creConfig = {
    geminiModel: "gemini-2.5-flash",
    evms: [
      {
        adapterAddress: adapterDeploy.address,
        registryAddress: registryDeploy.address,
        chainSelectorName: creChainSelectorName,
        gasLimit: "1000000",
      },
    ],
  };

  const creProject = {
    "local-simulation": {
      rpcs: [{ "chain-name": creChainSelectorName, url: creRpcUrl }],
    },
    staging: {
      "cre-cli": { "don-family": "zone-a" },
      account: { "workflow-owner-address": "" },
      rpcs: [{ "chain-name": creChainSelectorName, url: creRpcUrl }],
    },
  };

  // CRE simulation / vault manifests map logical secret IDs → env var names (values live in .env or DON Vault).
  // https://docs.chain.link/cre/guides/workflow/secrets/using-secrets-simulation-go
  const creSecretsManifest = {
    secretsNames: {
      GEMINI_API_KEY: ["GEMINI_API_KEY"],
      PRIVATE_KEY: ["PRIVATE_KEY"],
    },
  };

  try {
    if (!fs.existsSync(creDir)) fs.mkdirSync(creDir, { recursive: true });

    fs.writeFileSync(`${creDir}/config.json`, JSON.stringify(creConfig, null, 2));

    fs.writeFileSync(`${creBaseDir}/project.yaml`, "# CRE Project Settings\n" + require("js-yaml").dump(creProject));

    const secretsYaml =
      "# secrets.yaml — IDs → env names; put GEMINI_API_KEY / PRIVATE_KEY in prediction-market-job/.env for simulate\n" +
      require("js-yaml").dump(creSecretsManifest);
    fs.writeFileSync(`${creBaseDir}/secrets.yaml`, secretsYaml);
    fs.writeFileSync(`${creDir}/secrets.yaml`, secretsYaml);

    console.log(`   ✅ CRE configuration fully synced to ${creDir}\n`);
  } catch (e) {
    console.warn("   ⚠ Could not fully sync CRE config:", e);
  }

  // -----------------------------------------------------------------------
  // 7. Optional: seed demo markets + pools (localhost / CI with Pinata)
  // -----------------------------------------------------------------------
  if (process.env.SEED_MOCK_MARKETS === "true") {
    try {
      const { seedMockMarkets } = await import("../scripts/seedMockMarkets");
      await seedMockMarkets(hre, {
        registryAddress: registryDeploy.address as `0x${string}`,
        adapterAddress: adapterDeploy.address as `0x${string}`,
        ammUsdcAddress: ammUsdcDeploy.address as `0x${string}`,
        ammEurcAddress: ammEurcDeploy.address as `0x${string}`,
        usdcAddress: usdcAddress as `0x${string}`,
        eurcAddress: eurcAddress as `0x${string}`,
        deployer,
      });
    } catch (e) {
      console.warn("   ⚠ SEED_MOCK_MARKETS failed:", e);
    }
  }

  // -----------------------------------------------------------------------
  // Summary
  // -----------------------------------------------------------------------
  console.log("════════════════════════════════════════════");
  console.log("                DEPLOYMENT SUMMARY             ");
  console.log("════════════════════════════════════════════");
  console.log(`USDC collateral:       ${usdcAddress}`);
  console.log(`EURC collateral:       ${eurcAddress}`);
  console.log(`ConditionalTokens:      ${ctfDeploy.address}`);
  console.log(`AiCTFAdapter:           ${adapterDeploy.address}`);
  console.log(`MarketRegistry:         ${registryDeploy.address}`);
  console.log(`PredictionMarketAMM_USDC: ${ammUsdcDeploy.address}`);
  console.log(`PredictionMarketAMM_EURC: ${ammEurcDeploy.address}`);
  console.log(`AutoFinalizerUpkeep:    ${upkeepDeploy.address}`);
  console.log("════════════════════════════════════════════\n");
};

export default deploy;
deploy.tags = ["CTFPredictionMarket", "all"];
