import * as dotenv from "dotenv";
dotenv.config();
import { ethers } from "hardhat";

async function main() {
  const ammAddress = "0x01F6cf699218FeE60A9CC66baF4E59F7d35376A7"; // From your error message
  console.log("Checking AMM at:", ammAddress);

  const amm = await ethers.getContractAt("PredictionMarketAMM", ammAddress);

  try {
    const allPools = await amm.getAllPools();
    console.log("Pools in allPools array:", allPools.length);
    allPools.forEach((p, i) => console.log(`  [${i}]: ${p}`));

    const suspectId = "0xfcee18a1c6b0609ab58f640d83c6643f885cbca9d5aded5cd65f5e6464a69481";
    const pool = await amm.getPool(suspectId);
    console.log("\nChecking suspect conditionId:", suspectId);
    console.log("Exists in mapping:", pool.exists);
    console.log("LP Owner:", pool.lpOwner);

  } catch (e) {
    console.error("Error calling contract:", e);
  }
}

main().catch(console.error);
