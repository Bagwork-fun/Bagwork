/**
 * Seeds demo markets from fixtures/mock-markets (manifest + JSON metadata).
 * Requires PINATA_API_KEY + PINATA_SECRET_API_KEY in env unless each manifest row has pinnedCid set.
 * Optional: SEED_CREATE_POOLS=true — also creates AMM pools with deployer liquidity.
 */
import * as fs from "fs";
import * as path from "path";
import type { HardhatRuntimeEnvironment } from "hardhat/types";

const erc20ApproveAbi = ["function approve(address,uint256) external returns (bool)"];

type ManifestEntry = {
  metadataFile: string;
  rail: "USDC" | "EURC";
  pinnedCid?: string;
};

export type SeedMockMarketsOpts = {
  registryAddress: `0x${string}`;
  adapterAddress: `0x${string}`;
  ammUsdcAddress: `0x${string}`;
  ammEurcAddress: `0x${string}`;
  usdcAddress: `0x${string}`;
  eurcAddress: `0x${string}`;
  deployer: string;
};

async function pinJsonToPinata(metadata: Record<string, unknown>): Promise<string> {
  const key = process.env.PINATA_API_KEY ?? process.env.NEXT_PUBLIC_PINATA_API_KEY;
  const secret = process.env.PINATA_SECRET_API_KEY ?? process.env.NEXT_PUBLIC_PINATA_SECRET_KEY;
  if (!key || !secret) {
    throw new Error("Pinata credentials missing (PINATA_API_KEY + PINATA_SECRET_API_KEY)");
  }
  const res = await fetch("https://api.pinata.cloud/pinning/pinJSONToIPFS", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      pinata_api_key: key,
      pinata_secret_api_key: secret,
    },
    body: JSON.stringify({ pinataContent: metadata }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Pinata pin failed ${res.status}: ${text}`);
  }
  const json = (await res.json()) as { IpfsHash: string };
  return json.IpfsHash;
}

function computePositionIds(
  ethers: HardhatRuntimeEnvironment["ethers"],
  collateral: `0x${string}`,
  adapter: `0x${string}`,
  questionId: `0x${string}`,
): { conditionId: `0x${string}`; yesTokenId: bigint; noTokenId: bigint } {
  const outcomeSlotCount = 2;
  const conditionId = ethers.keccak256(
    ethers.solidityPacked(["address", "bytes32", "uint256"], [adapter, questionId, BigInt(outcomeSlotCount)]),
  ) as `0x${string}`;
  const yesCollection = ethers.keccak256(ethers.solidityPacked(["bytes32", "uint256"], [conditionId, 1n]));
  const noCollection = ethers.keccak256(ethers.solidityPacked(["bytes32", "uint256"], [conditionId, 2n]));
  const yesTokenId = BigInt(
    ethers.keccak256(ethers.solidityPacked(["address", "bytes32"], [collateral, yesCollection])),
  );
  const noTokenId = BigInt(
    ethers.keccak256(ethers.solidityPacked(["address", "bytes32"], [collateral, noCollection])),
  );
  return { conditionId, yesTokenId, noTokenId };
}

export async function seedMockMarkets(hre: HardhatRuntimeEnvironment, opts: SeedMockMarketsOpts): Promise<void> {
  const { ethers } = hre;
  const signer = await ethers.getSigner(opts.deployer);
  const fixtureDir = path.join(__dirname, "../fixtures/mock-markets");
  const manifestRaw = fs.readFileSync(path.join(fixtureDir, "manifest.json"), "utf8");
  const manifest = JSON.parse(manifestRaw) as ManifestEntry[];

  const registry = await ethers.getContractAt("MarketRegistry", opts.registryAddress, signer);

  const futureResolution = BigInt(Math.floor(Date.now() / 1000) + 86400 * 400);

  console.log("\n🌱 SEED_MOCK_MARKETS — creating demo markets...\n");

  for (const entry of manifest) {
    const metaPath = path.join(fixtureDir, entry.metadataFile);
    const metadata = JSON.parse(fs.readFileSync(metaPath, "utf8")) as Record<string, unknown>;
    metadata.resolutionTime = Number(futureResolution);

    let cid = entry.pinnedCid?.trim();
    if (!cid) {
      try {
        cid = await pinJsonToPinata(metadata);
        console.log(`   📌 Pinned ${entry.metadataFile} → ${cid}`);
      } catch (e) {
        console.warn(`   ⚠ Skipping ${entry.metadataFile}: ${e instanceof Error ? e.message : e}`);
        continue;
      }
    }

    const rail = entry.rail === "EURC" ? 1 : 0;
    const tx = await registry.createMarket(cid, 2n, futureResolution, rail);
    await tx.wait();

    const questionId = ethers.keccak256(ethers.toUtf8Bytes(cid)) as `0x${string}`;
    console.log(`   ✅ MarketRegistry.createMarket rail=${entry.rail} questionId=${questionId.slice(0, 14)}…`);

    if (process.env.SEED_CREATE_POOLS === "true") {
      const collateral = (entry.rail === "EURC" ? opts.eurcAddress : opts.usdcAddress) as `0x${string}`;
      const ammAddr = (entry.rail === "EURC" ? opts.ammEurcAddress : opts.ammUsdcAddress) as `0x${string}`;
      const amm = await ethers.getContractAt("PredictionMarketAMM", ammAddr, signer);
      const token = new ethers.Contract(collateral, erc20ApproveAbi, signer);

      const { conditionId, yesTokenId, noTokenId } = computePositionIds(
        ethers,
        collateral,
        opts.adapterAddress,
        questionId,
      );

      const liquidity = ethers.parseUnits("750", 6);
      await (await token.approve(ammAddr, liquidity)).wait();
      const cp = await amm.createPool(conditionId, yesTokenId, noTokenId, liquidity, 50, 10);
      await cp.wait();
      console.log(`      💧 Created pool on ${entry.rail} AMM`);
    }
  }

  console.log("\n   Seed complete.\n");
}
