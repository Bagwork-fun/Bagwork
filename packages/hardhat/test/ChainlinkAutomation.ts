import { expect } from "chai";
import { ethers } from "hardhat";
import {
  ConditionalTokens,
  AiCTFAdapter,
  MarketRegistry,
  AutoFinalizerUpkeep,
  MockUSDC,
} from "../typechain-types";

describe("🤖 Chainlink Automation — AutoFinalizerUpkeep", function () {
  let owner: any;
  let forwarder: any;
  let ctf: ConditionalTokens;
  let adapter: AiCTFAdapter;
  let registry: MarketRegistry;
  let upkeep: AutoFinalizerUpkeep;
  let usdc: MockUSDC;

  const IPFS_CID = "QmTestChainlinkAutomation123";
  const OUTCOME_COUNT = 2;
  const DISPUTE_WINDOW = 60; // 60 seconds

  let questionId: string;

  async function increaseTime(seconds: number) {
    await ethers.provider.send("evm_increaseTime", [seconds]);
    await ethers.provider.send("evm_mine", []);
  }

  before(async function () {
    [owner, forwarder] = await ethers.getSigners();

    // Deploy MockUSDC
    const USDC = await ethers.getContractFactory("MockUSDC");
    usdc = (await USDC.deploy()) as unknown as MockUSDC;
    await usdc.waitForDeployment();

    // Deploy ConditionalTokens
    const CTF = await ethers.getContractFactory("ConditionalTokens");
    ctf = (await CTF.deploy()) as unknown as ConditionalTokens;
    await ctf.waitForDeployment();

    // Deploy AiCTFAdapter
    const Adapter = await ethers.getContractFactory("AiCTFAdapter");
    adapter = (await Adapter.deploy(
      await ctf.getAddress(),
      await forwarder.getAddress(),
      DISPUTE_WINDOW,
      [await owner.getAddress()],
      1
    )) as unknown as AiCTFAdapter;
    await adapter.waitForDeployment();

    // Deploy MarketRegistry
    const Registry = await ethers.getContractFactory("MarketRegistry");
    registry = (await Registry.deploy(await adapter.getAddress())) as unknown as MarketRegistry;
    await registry.waitForDeployment();

    await adapter.setRegistry(await registry.getAddress());

    // Deploy AutoFinalizerUpkeep
    const Upkeep = await ethers.getContractFactory("AutoFinalizerUpkeep");
    upkeep = (await Upkeep.deploy(
      await adapter.getAddress(),
      await registry.getAddress()
    )) as unknown as AutoFinalizerUpkeep;
    await upkeep.waitForDeployment();

    questionId = ethers.keccak256(ethers.toUtf8Bytes(IPFS_CID));
  });

  it("should initialize a market", async function () {
    const futureTime = Math.floor(Date.now() / 1000) + 3600;
    await registry.createMarket(IPFS_CID, OUTCOME_COUNT, futureTime, 0);
    const q = await adapter.getQuestion(questionId);
    expect(q.status).to.equal(1); // Active
  });

  it("checkUpkeep should return false when no market is in Proposed state", async function () {
    const [upkeepNeeded] = await upkeep.checkUpkeep("0x");
    expect(upkeepNeeded).to.be.false;
  });

  it("should propose a resolution via CRE forwarder", async function () {
    const payouts = [1n, 0n];
    const report = ethers.AbiCoder.defaultAbiCoder().encode(
      ["bytes32", "uint256[]"],
      [questionId, payouts]
    );
    
    await adapter.connect(forwarder).onReport("0x", report);
    
    const q = await adapter.getQuestion(questionId);
    expect(q.status).to.equal(2); // Proposed
  });

  it("checkUpkeep should return false during the dispute window", async function () {
    const [upkeepNeeded] = await upkeep.checkUpkeep("0x");
    expect(upkeepNeeded).to.be.false;
  });

  it("checkUpkeep should return true after the dispute window elapses", async function () {
    await increaseTime(DISPUTE_WINDOW + 1);
    const [upkeepNeeded, performData] = await upkeep.checkUpkeep("0x");
    expect(upkeepNeeded).to.be.true;
    
    const decodedQId = ethers.AbiCoder.defaultAbiCoder().decode(["bytes32"], performData)[0];
    expect(decodedQId).to.equal(questionId);
  });

  it("performUpkeep should finalize the resolution", async function () {
    const [, performData] = await upkeep.checkUpkeep("0x");
    
    await expect(upkeep.performUpkeep(performData))
      .to.emit(adapter, "MarketResolved")
      .withArgs(questionId, [1n, 0n]);
      
    const q = await adapter.getQuestion(questionId);
    expect(q.status).to.equal(3); // Resolved
    
    const ctfPayoutDenom = await ctf.payoutDenominator(
      await ctf.getConditionId(await adapter.getAddress(), questionId, OUTCOME_COUNT)
    );
    expect(ctfPayoutDenom).to.be.gt(0n);
  });

  it("checkUpkeep should return false after resolution", async function () {
    const [upkeepNeeded] = await upkeep.checkUpkeep("0x");
    expect(upkeepNeeded).to.be.false;
  });
});
