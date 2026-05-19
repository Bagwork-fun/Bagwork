/**
 * Rebuilds nextjs/contracts/deployedContracts.ts from deployments/ (no on-chain deploy).
 */
import generateTsAbis from "./generateTsAbis";

async function main() {
  // generateTsAbis does not use hre; signature matches hardhat-deploy DeployFunction.
  await generateTsAbis({} as never);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
