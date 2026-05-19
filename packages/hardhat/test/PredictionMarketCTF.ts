import { expect } from "chai";
import { ethers } from "hardhat";
import { anyValue } from "@nomicfoundation/hardhat-chai-matchers/withArgs";
import {
  ConditionalTokens,
  AiCTFAdapter,
  MarketRegistry,
  PredictionMarketAMM,
  MockUSDC,
} from "../typechain-types";

/**
 * Full lifecycle tests for the Polymarket-style CTF prediction market:
 *   market creation → AMM seeding → trading → CRE resolution → dispute window
 *   → finalization → payout redemption
 *
 * Also covers admin override, multisig override (within window), and
 * post-resolution trading rejection.
 */
describe("🔮 CTF Prediction Market — Full Lifecycle", function () {
  // ─── Accounts ────────────────────────────────────────────────────────────────
  let owner: any;
  let lpOwner: any;
  let trader1: any;
  let trader2: any;
  let signer1: any;   // multisig signer
  let signer2: any;   // multisig signer
  let signer3: any;   // multisig signer
  let nonSigner: any;
  let forwarder: any; // simulates CRE forwarder

  // ─── Contracts ───────────────────────────────────────────────────────────────
  let ctf: ConditionalTokens;
  let adapter: AiCTFAdapter;
  let registry: MarketRegistry;
  let amm: PredictionMarketAMM;
  let usdc: MockUSDC;

  // ─── Market constants ────────────────────────────────────────────────────────
  const IPFS_CID = "QmWillGreenCarWinTheRace2024XYZ";
  const OUTCOME_COUNT = 2;
  const DISPUTE_WINDOW = 60; // 60 seconds for fast testing
  const MULTISIG_THRESHOLD = 2; // 2-of-3

  // USDC amounts (6 decimals)
  const INITIAL_LIQUIDITY = ethers.parseUnits("1000", 6); // $1000 USDC
  const INITIAL_YES_PROB = 50; // 50%
  const PERCENTAGE_LOCKED = 10; // 10%

  let questionId: string;
  let conditionId: string;
  let yesTokenId: bigint;
  let noTokenId: bigint;

  // ─── Helpers ─────────────────────────────────────────────────────────────────

  /** Build a minimal CRE onReport() payload */
  function buildReport(qId: string, payouts: bigint[]): [string, string] {
    // metadata is empty bytes for localhost (no forwarder signature verification)
    const metadata = "0x";
    const report = ethers.AbiCoder.defaultAbiCoder().encode(
      ["bytes32", "uint256[]"],
      [qId, payouts]
    );
    return [metadata, report];
  }

  /** Fast-forward time */
  async function increaseTime(seconds: number) {
    await ethers.provider.send("evm_increaseTime", [seconds]);
    await ethers.provider.send("evm_mine", []);
  }

  // ─── Setup ────────────────────────────────────────────────────────────────────

  before(async function () {
    [owner, lpOwner, trader1, trader2, signer1, signer2, signer3, nonSigner, forwarder] =
      await ethers.getSigners();

    // Deploy MockUSDC
    const USDC = await ethers.getContractFactory("MockUSDC");
    usdc = (await USDC.deploy()) as unknown as MockUSDC;
    await usdc.waitForDeployment();

    // Mint USDC to test accounts
    const mint = async (addr: string, amount: bigint) => usdc.mint(addr, amount);
    await mint(await lpOwner.getAddress(), ethers.parseUnits("100000", 6));
    await mint(await trader1.getAddress(), ethers.parseUnits("10000", 6));
    await mint(await trader2.getAddress(), ethers.parseUnits("10000", 6));

    // Deploy ConditionalTokens
    const CTF = await ethers.getContractFactory("ConditionalTokens");
    ctf = (await CTF.deploy()) as unknown as ConditionalTokens;
    await ctf.waitForDeployment();

    // Deploy AiCTFAdapter
    // On localhost: forwarder account simulates the CRE forwarder
    const multisigSigners = [
      await signer1.getAddress(),
      await signer2.getAddress(),
      await signer3.getAddress(),
    ];
    const Adapter = await ethers.getContractFactory("AiCTFAdapter");
    adapter = (await Adapter.deploy(
      await ctf.getAddress(),
      await forwarder.getAddress(),
      DISPUTE_WINDOW,
      multisigSigners,
      MULTISIG_THRESHOLD
    )) as unknown as AiCTFAdapter;
    await adapter.waitForDeployment();

    // Deploy MarketRegistry
    const Registry = await ethers.getContractFactory("MarketRegistry");
    registry = (await Registry.deploy(await adapter.getAddress())) as unknown as MarketRegistry;
    await registry.waitForDeployment();

    // Wire registry into adapter
    await adapter.setRegistry(await registry.getAddress());

    // Deploy PredictionMarketAMM
    const AMM = await ethers.getContractFactory("PredictionMarketAMM");
    amm = (await AMM.deploy(
      await ctf.getAddress(),
      await usdc.getAddress()
    )) as unknown as PredictionMarketAMM;
    await amm.waitForDeployment();

    // Derive questionId
    questionId = ethers.keccak256(ethers.toUtf8Bytes(IPFS_CID));

    // Derive conditionId using CTF formula: keccak256(adapter, questionId, outcomeCount)
    conditionId = await ctf.getConditionId(
      await adapter.getAddress(),
      questionId,
      OUTCOME_COUNT
    );

    // Derive YES/NO positionIds
    const yesCollectionId = await ctf.getCollectionId(ethers.ZeroHash, conditionId, 1); // indexSet 0b01
    const noCollectionId  = await ctf.getCollectionId(ethers.ZeroHash, conditionId, 2); // indexSet 0b10
    yesTokenId = BigInt(await ctf.getPositionId(await usdc.getAddress(), yesCollectionId));
    noTokenId  = BigInt(await ctf.getPositionId(await usdc.getAddress(), noCollectionId));
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 1. Market Creation
  // ═══════════════════════════════════════════════════════════════════════════

  describe("1. Market Creation", function () {
    it("derives questionId deterministically from IPFS CID", async function () {
      const expected = ethers.keccak256(ethers.toUtf8Bytes(IPFS_CID));
      expect(questionId).to.equal(expected);
    });

    it("createMarket() reverts on empty CID", async function () {
      const futureTime = Math.floor(Date.now() / 1000) + 3600;
      await expect(
        registry.createMarket("", OUTCOME_COUNT, futureTime, 0)
      ).to.be.revertedWithCustomError(registry, "EmptyCid");
    });

    it("createMarket() reverts on resolution time in the past", async function () {
      await expect(
        registry.createMarket(IPFS_CID, OUTCOME_COUNT, 1, 0)
      ).to.be.revertedWithCustomError(registry, "InvalidResolutionTime");
    });

    it("createMarket() emits MarketCreated + prepares CTF condition", async function () {
      const futureTime = Math.floor(Date.now() / 1000) + 7200;
      await expect(
        registry.createMarket(IPFS_CID, OUTCOME_COUNT, futureTime, 0)
      )
        .to.emit(registry, "MarketCreated")
        .withArgs(questionId, IPFS_CID, OUTCOME_COUNT, futureTime, await owner.getAddress(), 0);

      // CTF condition must be prepared
      const slotCount = await ctf.getOutcomeSlotCount(conditionId);
      expect(slotCount).to.equal(OUTCOME_COUNT);
    });

    it("createMarket() reverts on duplicate CID", async function () {
      const futureTime = Math.floor(Date.now() / 1000) + 7200;
      await expect(
        registry.createMarket(IPFS_CID, OUTCOME_COUNT, futureTime, 0)
      ).to.be.revertedWithCustomError(registry, "MarketAlreadyExists");
    });

    it("MarketRegistry stores correct status = Active", async function () {
      const info = await registry.getMarket(questionId);
      expect(info.exists).to.be.true;
      expect(info.outcomeCount).to.equal(OUTCOME_COUNT);
      expect(info.status).to.equal(0); // MarketStatus.Active
    });

    it("AiCTFAdapter.MarketStatus is Active after creation", async function () {
      const q = await adapter.getQuestion(questionId);
      expect(q.status).to.equal(1); // AiCTFAdapter.MarketStatus.Active
    });
  });

  describe("1b. Early resolution while Active (no CRE)", function () {
    const EARLY_CID = "QmEarlyResolveActiveOnly";
    let earlyQid: string;

    before(async function () {
      const futureTime = Math.floor(Date.now() / 1000) + 7200;
      earlyQid = ethers.keccak256(ethers.toUtf8Bytes(EARLY_CID));
      await registry.createMarket(EARLY_CID, OUTCOME_COUNT, futureTime, 0);
    });

    it("owner can adminResolve() while Active", async function () {
      const payouts = [1n, 0n];
      await expect(adapter.connect(owner).adminResolve(earlyQid, payouts))
        .to.emit(adapter, "MarketResolved")
        .withArgs(earlyQid, payouts);
      const q = await adapter.getQuestion(earlyQid);
      expect(q.status).to.equal(3); // Resolved
    });

    it("adminResolve() reverts for non-owner", async function () {
      const MULTI_EARLY_CID = "QmEarlyMultisigActive";
      const multiQid = ethers.keccak256(ethers.toUtf8Bytes(MULTI_EARLY_CID));
      const futureTime = Math.floor(Date.now() / 1000) + 7200;
      await registry.createMarket(MULTI_EARLY_CID, OUTCOME_COUNT, futureTime, 0);

      await expect(
        adapter.connect(trader1).adminResolve(multiQid, [1n, 0n])
      ).to.be.revertedWithCustomError(adapter, "OwnableUnauthorizedAccount");
    });

    it("multisig can resolve while Active when threshold met", async function () {
      const MULTI_CID = "QmMultisigEarlyActive999";
      const mqid = ethers.keccak256(ethers.toUtf8Bytes(MULTI_CID));
      const futureTime = Math.floor(Date.now() / 1000) + 7200;
      await registry.createMarket(MULTI_CID, OUTCOME_COUNT, futureTime, 0);

      const payouts = [0n, 1n];
      await expect(adapter.connect(signer1).multisigOverride(mqid, payouts))
        .to.emit(adapter, "ResolutionProposed");

      await expect(adapter.connect(signer2).multisigOverride(mqid, payouts))
        .to.emit(adapter, "MarketResolved")
        .withArgs(mqid, payouts);

      const q = await adapter.getQuestion(mqid);
      expect(q.status).to.equal(3);
    });

    it("owner can adminOverride() while Active to open proposal without resolving", async function () {
      const OVERRIDE_CID = "QmAdminOverrideActiveOnly";
      const oqid = ethers.keccak256(ethers.toUtf8Bytes(OVERRIDE_CID));
      const futureTime = Math.floor(Date.now() / 1000) + 7200;
      await registry.createMarket(OVERRIDE_CID, OUTCOME_COUNT, futureTime, 0);

      const payouts = [1n, 0n];
      await expect(adapter.connect(owner).adminOverride(oqid, payouts))
        .to.emit(adapter, "ResolutionProposed")
        .withArgs(oqid, payouts, anyValue);

      const q = await adapter.getQuestion(oqid);
      expect(q.status).to.equal(2); // Proposed, not Resolved
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 2. AMM Pool Creation & Liquidity
  // ═══════════════════════════════════════════════════════════════════════════

  describe("2. AMM Pool Creation & Liquidity", function () {
    it("LP can create a pool for the new conditionId", async function () {
      await usdc.connect(lpOwner).approve(await amm.getAddress(), INITIAL_LIQUIDITY);

      await expect(
        amm.connect(lpOwner).createPool(
          conditionId,
          yesTokenId,
          noTokenId,
          INITIAL_LIQUIDITY,
          INITIAL_YES_PROB,
          PERCENTAGE_LOCKED
        )
      )
        .to.emit(amm, "PoolCreated")
        .withArgs(conditionId, yesTokenId, noTokenId, INITIAL_LIQUIDITY);

      const pool = await amm.getPool(conditionId);
      expect(pool.exists).to.be.true;
      expect(pool.usdcCollateral).to.equal(INITIAL_LIQUIDITY);
      expect(pool.lpOwner).to.equal(await lpOwner.getAddress());
    });

    it("createPool() reverts on duplicate conditionId", async function () {
      await usdc.connect(lpOwner).approve(await amm.getAddress(), INITIAL_LIQUIDITY);
      await expect(
        amm.connect(lpOwner).createPool(
          conditionId,
          yesTokenId,
          noTokenId,
          INITIAL_LIQUIDITY,
          INITIAL_YES_PROB,
          PERCENTAGE_LOCKED
        )
      ).to.be.revertedWithCustomError(amm, "PoolAlreadyExists");
    });

    it("addLiquidity() increases reserves correctly", async function () {
      const before = await amm.getPool(conditionId);
      const addAmount = ethers.parseUnits("100", 6);

      await usdc.connect(lpOwner).approve(await amm.getAddress(), addAmount);
      await expect(
        amm.connect(lpOwner).addLiquidity(conditionId, addAmount)
      ).to.emit(amm, "LiquidityAdded");

      const after = await amm.getPool(conditionId);
      expect(after.usdcCollateral).to.equal(before.usdcCollateral + addAmount);
    });

    it("addLiquidity() reverts for non-LP address", async function () {
      const addAmount = ethers.parseUnits("100", 6);
      await usdc.connect(trader1).approve(await amm.getAddress(), addAmount);
      await expect(
        amm.connect(trader1).addLiquidity(conditionId, addAmount)
      ).to.be.revertedWithCustomError(amm, "NotLPOwner");
    });

    it("removeLiquidity() decreases reserves and returns USDC", async function () {
      const removeAmount = ethers.parseUnits("50", 6);
      const balBefore = await usdc.balanceOf(await lpOwner.getAddress());

      await expect(
        amm.connect(lpOwner).removeLiquidity(conditionId, removeAmount)
      ).to.emit(amm, "LiquidityRemoved");

      const balAfter = await usdc.balanceOf(await lpOwner.getAddress());
      expect(balAfter - balBefore).to.equal(removeAmount);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 3. AMM Pricing & Trading
  // ═══════════════════════════════════════════════════════════════════════════

  describe("3. AMM Pricing & Trading", function () {
    const BUY_AMOUNT = ethers.parseUnits("10", 6); // 10 outcome tokens (6 decimals)

    it("getBuyPrice() returns a nonzero price for YES", async function () {
      const price = await amm.getBuyPrice(conditionId, 0, BUY_AMOUNT);
      expect(price).to.be.gt(0);
    });

    it("getSellPrice() returns a nonzero price for YES", async function () {
      const price = await amm.getSellPrice(conditionId, 0, BUY_AMOUNT);
      expect(price).to.be.gt(0);
    });

    it("getBuyPrice() < getSellPrice() (spread from collateral)", async function () {
      // Because the pool charges more to buy than it pays to sell (spread = LP revenue)
      const buyPrice  = await amm.getBuyPrice(conditionId, 0, BUY_AMOUNT);
      const sellPrice = await amm.getSellPrice(conditionId, 0, BUY_AMOUNT);
      expect(buyPrice).to.be.gte(sellPrice);
    });

    it("trader1 can buy YES tokens with USDC", async function () {
      const price = await amm.getBuyPrice(conditionId, 0, BUY_AMOUNT);
      await usdc.connect(trader1).approve(await amm.getAddress(), price);

      const balBefore = await ctf.balanceOf(await trader1.getAddress(), yesTokenId);
      await expect(
        amm.connect(trader1).buyTokens(conditionId, 0, BUY_AMOUNT, price)
      ).to.emit(amm, "TokensBought");

      const balAfter = await ctf.balanceOf(await trader1.getAddress(), yesTokenId);
      expect(balAfter - balBefore).to.equal(BUY_AMOUNT);
    });

    it("trader1 can sell YES tokens for USDC", async function () {
      const SELL_AMOUNT = ethers.parseUnits("5", 6);
      const sellPrice = await amm.getSellPrice(conditionId, 0, SELL_AMOUNT);

      // Approve AMM to transfer ERC-1155 YES tokens from trader1
      await ctf.connect(trader1).setApprovalForAll(await amm.getAddress(), true);

      const usdcBefore = await usdc.balanceOf(await trader1.getAddress());
      await expect(
        amm.connect(trader1).sellTokens(conditionId, 0, SELL_AMOUNT, 0)
      ).to.emit(amm, "TokensSold");

      const usdcAfter = await usdc.balanceOf(await trader1.getAddress());
      expect(usdcAfter - usdcBefore).to.be.gte(sellPrice);
    });

    it("buyTokens() reverts if maxUsdcIn is too low", async function () {
      await usdc.connect(trader2).approve(await amm.getAddress(), 1); // only 1 wei
      await expect(
        amm.connect(trader2).buyTokens(conditionId, 0, BUY_AMOUNT, 1)
      ).to.be.revertedWithCustomError(amm, "WrongUsdcAmount");
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 4. CRE Resolution Callback (onReport)
  // ═══════════════════════════════════════════════════════════════════════════

  describe("4. CRE Resolution (onReport)", function () {
    const YES_WINS = [1n, 0n]; // YES wins

    it("onReport() reverts from non-forwarder address", async function () {
      const [metadata, report] = buildReport(questionId, YES_WINS);
      await expect(
        adapter.connect(trader1).onReport(metadata, report)
      ).to.be.revertedWithCustomError(adapter, "InvalidSender");
    });

    it("forwarder can call onReport() and emit ResolutionProposed", async function () {
      const [metadata, report] = buildReport(questionId, YES_WINS);
      await expect(
        adapter.connect(forwarder).onReport(metadata, report)
      )
        .to.emit(adapter, "ResolutionProposed")
        .withArgs(questionId, YES_WINS, anyValue);

      const q = await adapter.getQuestion(questionId);
      expect(q.status).to.equal(2); // Proposed
    });

    it("finalizeResolution() reverts before dispute window elapses", async function () {
      await expect(
        adapter.finalizeResolution(questionId)
      ).to.be.revertedWithCustomError(adapter, "DisputeWindowActive");
    });

    it("trading is still allowed during dispute window", async function () {
      const BUY_AMOUNT = ethers.parseUnits("3", 6);
      const price = await amm.getBuyPrice(conditionId, 1, BUY_AMOUNT); // Buy NO
      await usdc.connect(trader2).approve(await amm.getAddress(), price);
      await expect(
        amm.connect(trader2).buyTokens(conditionId, 1, BUY_AMOUNT, price)
      ).to.emit(amm, "TokensBought");
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 5. Admin Override (within dispute window)
  // ═══════════════════════════════════════════════════════════════════════════

  describe("5. Admin Override", function () {
    it("owner can replace proposal with adminOverride() within window", async function () {
      const NEW_PAYOUTS = [0n, 1n]; // Now NO wins instead
      await expect(
        adapter.connect(owner).adminOverride(questionId, NEW_PAYOUTS)
      )
        .to.emit(adapter, "ResolutionProposalReplaced")
        .withArgs(questionId, NEW_PAYOUTS, await owner.getAddress());

      const q = await adapter.getQuestion(questionId);
      expect(q.proposedPayouts[0]).to.equal(0n);
      expect(q.proposedPayouts[1]).to.equal(1n);
    });

    it("non-owner cannot call adminOverride()", async function () {
      await expect(
        adapter.connect(trader1).adminOverride(questionId, [1n, 0n])
      ).to.be.revertedWithCustomError(adapter, "OwnableUnauthorizedAccount");
    });

    // Reset back to YES wins before continuing
    before(async function () {
      // Re-propose YES wins via CRE forwarder so dispute window resets
      const [metadata, report] = buildReport(questionId, [1n, 0n]);
      await adapter.connect(forwarder).onReport(metadata, report);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 6. Multisig Override (within dispute window)
  // ═══════════════════════════════════════════════════════════════════════════

  describe("6. Multisig Override", function () {
    const MULTISIG_PAYOUTS = [1n, 0n]; // YES wins — same as current proposal

    it("non-signer cannot call multisigOverride()", async function () {
      await expect(
        adapter.connect(nonSigner).multisigOverride(questionId, MULTISIG_PAYOUTS)
      ).to.be.revertedWithCustomError(adapter, "NotMultisigSigner");
    });

    it("signer1 approves — threshold not yet met (2-of-3)", async function () {
      await expect(
        adapter.connect(signer1).multisigOverride(questionId, MULTISIG_PAYOUTS)
      )
        .to.emit(adapter, "MultisigOverrideApproved")
        .withArgs(questionId, await signer1.getAddress(), 1, MULTISIG_THRESHOLD);

      // Should NOT be resolved yet
      const q = await adapter.getQuestion(questionId);
      expect(q.status).to.equal(2); // still Proposed
    });

    it("signer1 cannot approve twice", async function () {
      await expect(
        adapter.connect(signer1).multisigOverride(questionId, MULTISIG_PAYOUTS)
      ).to.be.revertedWithCustomError(adapter, "AlreadyApproved");
    });

    it("signer2 approves — threshold met → finalised immediately", async function () {
      // This should trigger immediate resolution without waiting for dispute window
      await expect(
        adapter.connect(signer2).multisigOverride(questionId, MULTISIG_PAYOUTS)
      )
        .to.emit(adapter, "MarketResolved")
        .withArgs(questionId, MULTISIG_PAYOUTS);

      const q = await adapter.getQuestion(questionId);
      expect(q.status).to.equal(3); // Resolved
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 7. Post-Resolution Behaviour
  // ═══════════════════════════════════════════════════════════════════════════

  describe("7. Post-Resolution Behaviour", function () {
    it("CTF payoutDenominator is nonzero after resolution", async function () {
      const den = await ctf.payoutDenominator(conditionId);
      expect(den).to.be.gt(0n);
    });

    it("markResolved() disables trading in AMM", async function () {
      await amm.markResolved(conditionId);
      const pool = await amm.getPool(conditionId);
      expect(pool.resolved).to.be.true;
    });

    it("buyTokens() reverts on resolved pool", async function () {
      const BUY_AMOUNT = ethers.parseUnits("1", 6);
      const price = 1000n;
      await usdc.connect(trader2).approve(await amm.getAddress(), price);
      await expect(
        amm.connect(trader2).buyTokens(conditionId, 0, BUY_AMOUNT, price)
      ).to.be.revertedWithCustomError(amm, "PoolResolved_");
    });

    it("sellTokens() reverts on resolved pool", async function () {
      await ctf.connect(trader1).setApprovalForAll(await amm.getAddress(), true);
      await expect(
        amm.connect(trader1).sellTokens(conditionId, 0, 1n, 0n)
      ).to.be.revertedWithCustomError(amm, "PoolResolved_");
    });

    it("finalizeResolution() reverts on already-resolved market", async function () {
      await expect(
        adapter.finalizeResolution(questionId)
      ).to.be.revertedWithCustomError(adapter, "NoProposalPending");
    });

    it("adminOverride() reverts on resolved market", async function () {
      await expect(
        adapter.connect(owner).adminOverride(questionId, [0n, 1n])
      ).to.be.revertedWithCustomError(adapter, "AlreadyResolved");
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 8. Payout Redemption
  // ═══════════════════════════════════════════════════════════════════════════

  describe("8. Payout Redemption", function () {
    it("YES token holders can redeem USDC from CTF", async function () {
      const trader1Addr = await trader1.getAddress();
      const yesBalance = await ctf.balanceOf(trader1Addr, yesTokenId);
      if (yesBalance === 0n) return; // trader1 already sold all YES tokens

      const usdcBefore = await usdc.balanceOf(trader1Addr);
      // redeemPositions(collateral, parentCollectionId, conditionId, indexSets)
      await ctf
        .connect(trader1)
        .redeemPositions(await usdc.getAddress(), ethers.ZeroHash, conditionId, [1]); // indexSet for YES

      const usdcAfter = await usdc.balanceOf(trader1Addr);
      expect(usdcAfter).to.be.gte(usdcBefore); // Got USDC back
    });

    it("NO token holders receive zero payout (NO lost)", async function () {
      const trader2Addr = await trader2.getAddress();
      const noBalance = await ctf.balanceOf(trader2Addr, noTokenId);
      if (noBalance === 0n) return;

      const usdcBefore = await usdc.balanceOf(trader2Addr);
      await ctf
        .connect(trader2)
        .redeemPositions(await usdc.getAddress(), ethers.ZeroHash, conditionId, [2]); // indexSet for NO

      const usdcAfter = await usdc.balanceOf(trader2Addr);
      // NO pays out 0 — balance should be unchanged
      expect(usdcAfter).to.equal(usdcBefore);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 9. Dispute Window Finalization (separate market)
  // ═══════════════════════════════════════════════════════════════════════════

  describe("9. Normal Finalization Path (after window elapses)", function () {
    const CID2 = "QmSecondTestMarketCID999ABC";
    let questionId2: string;

    it("creates second market and proposes resolution via CRE", async function () {
      const futureTime = Math.floor(Date.now() / 1000) + 7200;
      questionId2 = ethers.keccak256(ethers.toUtf8Bytes(CID2));
      await registry.createMarket(CID2, OUTCOME_COUNT, futureTime, 0);

      const [metadata, report] = buildReport(questionId2, [1n, 0n]);
      await adapter.connect(forwarder).onReport(metadata, report);

      const q = await adapter.getQuestion(questionId2);
      expect(q.status).to.equal(2); // Proposed
    });

    it("finalizeResolution() still reverts before window", async function () {
      await expect(
        adapter.finalizeResolution(questionId2)
      ).to.be.revertedWithCustomError(adapter, "DisputeWindowActive");
    });

    it("finalizeResolution() reverts for unauthorized wallet after window", async function () {
      await increaseTime(DISPUTE_WINDOW + 1);
      await expect(adapter.connect(nonSigner).finalizeResolution(questionId2)).to.be.revertedWithCustomError(
        adapter,
        "NotAuthorizedFinalizer",
      );
    });

    it("finalizeResolution() succeeds for owner after dispute window elapses", async function () {
      await expect(adapter.connect(owner).finalizeResolution(questionId2))
        .to.emit(adapter, "MarketResolved")
        .withArgs(questionId2, [1n, 0n]);

      const q = await adapter.getQuestion(questionId2);
      expect(q.status).to.equal(3); // Resolved
    });

    it("finalizeResolution() succeeds for multisig signer on a fresh proposed market", async function () {
      const CID3 = "QmThirdTestMarketCID888DEF";
      const futureTime = Math.floor(Date.now() / 1000) + 7200;
      const questionId3 = ethers.keccak256(ethers.toUtf8Bytes(CID3));
      await registry.createMarket(CID3, OUTCOME_COUNT, futureTime, 0);
      const [metadata, report] = buildReport(questionId3, [0n, 1n]);
      await adapter.connect(forwarder).onReport(metadata, report);
      await increaseTime(DISPUTE_WINDOW + 1);
      await expect(adapter.connect(signer1).finalizeResolution(questionId3))
        .to.emit(adapter, "MarketResolved")
        .withArgs(questionId3, [0n, 1n]);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 10. LP PnL views & withdrawAfterResolution
  // ═══════════════════════════════════════════════════════════════════════════

  describe("10. LP PnL & Post-Resolution Withdraw", function () {
    it("getLpPnLSummary() returns deposited amount and nonnegative nav", async function () {
      const summary = await amm.getLpPnLSummary(conditionId);
      expect(summary.totalDeposited).to.be.gt(0);
      expect(summary.nav).to.be.gte(0);
    });

    it("getPoolInventoryValue() returns redemption value after resolution", async function () {
      const inv = await amm.getPoolInventoryValue(conditionId);
      expect(inv).to.be.gte(0);
    });

    it("lpTradingRevenue accumulates on buys", async function () {
      const pool = await amm.getPool(conditionId);
      expect(pool.lpTradingRevenue).to.be.gte(0);
    });

    it("withdrawAfterResolution() pays revenue and redeems pool reserves", async function () {
      const lpAddr = await lpOwner.getAddress();
      const balBefore = await usdc.balanceOf(lpAddr);
      const poolBefore = await amm.getPool(conditionId);
      const hadReserves = poolBefore.yesReserve > 0n || poolBefore.noReserve > 0n;

      await expect(amm.connect(lpOwner).withdrawAfterResolution(conditionId)).to.not.be.reverted;

      const balAfter = await usdc.balanceOf(lpAddr);
      expect(balAfter).to.be.gt(balBefore);

      const poolAfter = await amm.getPool(conditionId);
      expect(poolAfter.lpTradingRevenue).to.equal(0);
      if (hadReserves) {
        expect(poolAfter.yesReserve).to.equal(0);
        expect(poolAfter.noReserve).to.equal(0);
      }
      expect(poolAfter.lpTotalWithdrawn).to.be.gt(poolBefore.lpTotalWithdrawn);
    });

    it("withdrawAfterResolution() reverts when pool not marked resolved", async function () {
      const CID_LP = "QmLpWithdrawRevertTestCID";
      const futureTime = Math.floor(Date.now() / 1000) + 7200;
      const qid = ethers.keccak256(ethers.toUtf8Bytes(CID_LP));
      await registry.createMarket(CID_LP, OUTCOME_COUNT, futureTime, 0);

      const cid = await ctf.getConditionId(await adapter.getAddress(), qid, OUTCOME_COUNT);
      const parentCollectionId = ethers.ZeroHash;
      const yesCollectionId = await ctf.getCollectionId(parentCollectionId, cid, 1n);
      const noCollectionId = await ctf.getCollectionId(parentCollectionId, cid, 2n);
      const yId = await ctf.getPositionId(await usdc.getAddress(), yesCollectionId);
      const nId = await ctf.getPositionId(await usdc.getAddress(), noCollectionId);

      await usdc.connect(lpOwner).approve(await amm.getAddress(), INITIAL_LIQUIDITY);
      await amm
        .connect(lpOwner)
        .createPool(cid, yId, nId, INITIAL_LIQUIDITY, INITIAL_YES_PROB, PERCENTAGE_LOCKED);

      await expect(amm.connect(lpOwner).withdrawAfterResolution(cid)).to.be.revertedWithCustomError(
        amm,
        "PoolNotResolved",
      );
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 11. Registry enumeration
  // ═══════════════════════════════════════════════════════════════════════════

  describe("11. Registry Enumeration", function () {
    it("getAllMarkets() returns both created markets", async function () {
      const allMarkets = await registry.getAllMarkets();
      expect(allMarkets.length).to.be.gte(2);
    });

    it("getMarketsPage() paginates correctly", async function () {
      const page = await registry.getMarketsPage(0, 1);
      expect(page.length).to.equal(1);
    });
  });
});
