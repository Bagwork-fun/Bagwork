/**
 * Overwrites prediction-market-job/config.json EVM addresses from
 * packages/hardhat/deployments/arcTestnet (AiCTFAdapter + MarketRegistry).
 *
 * Preserves geminiModel and gasLimit from the existing config when present.
 *
 * Usage (from repo root): yarn workspace prediction-market-cre-job sync:contracts
 */
"use strict";

const fs = require("fs");
const path = require("path");

const jobRoot = path.resolve(__dirname, "..");
const deploymentDir = path.resolve(jobRoot, "..", "..", "hardhat", "deployments", "arcTestnet");
const configPath = path.join(jobRoot, "config.json");

function readDeployedAddress(contractName) {
  const filePath = path.join(deploymentDir, `${contractName}.json`);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing deployment artifact: ${filePath}\nDeploy with: yarn deploy --network arcTestnet`);
  }
  const { address } = JSON.parse(fs.readFileSync(filePath, "utf8"));
  if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
    throw new Error(`Invalid address in ${filePath}`);
  }
  return address;
}

const adapterAddress = readDeployedAddress("AiCTFAdapter");
const registryAddress = readDeployedAddress("MarketRegistry");

let existing = {};
if (fs.existsSync(configPath)) {
  existing = JSON.parse(fs.readFileSync(configPath, "utf8"));
}

const next = {
  geminiModel: existing.geminiModel ?? "gemini-2.5-flash",
  evms: [
    {
      adapterAddress,
      registryAddress,
      chainSelectorName: "arc-testnet",
      gasLimit: existing.evms?.[0]?.gasLimit ?? "1000000",
    },
  ],
};

fs.writeFileSync(configPath, `${JSON.stringify(next, null, 2)}\n`);
console.log(
  `sync-config-from-hardhat: wrote ${path.relative(process.cwd(), configPath)} ` +
    `(arc-testnet AiCTFAdapter=${adapterAddress}, MarketRegistry=${registryAddress})`
);
