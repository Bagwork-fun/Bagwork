/**
 * Run CRE local simulation against a real Arc testnet tx that emitted
 * AiCTFAdapter.MarketInitialized.
 *
 * Prereqs:
 *   - GEMINI_API_KEY in `packages/cre-jobs/.env`, `prediction-market-job/.env`, repo root `.env`, or
 *     `packages/hardhat/.env` (later overrides). Aliases: GOOGLE_API_KEY, GEMINI_KEY.
 *   - For --broadcast: CRE_ETH_PRIVATE_KEY (what `cre` CLI reads) or PRIVATE_KEY / DEPLOYER_PRIVATE_KEY /
 *     CRE_ETH_PRIVATE_KEY in layered `.env` files — must be 64 hex chars (32-byte secp256k1 key), optional `0x`.
 *
 *   CRE TS layout: project root is `packages/cre-jobs`; this script writes `packages/cre-jobs/secrets.yaml`,
 *   merges GEMINI into `config.sim-run.json` (local-simulation target only), and runs
 *   `cre workflow simulate prediction-market-job -R .` from that root.
 *
 * Tx selection (pick one):
 *   - Set CRE_SIMULATE_MARKET_INIT_TX=0x... (optional CRE_SIMULATE_MARKET_INIT_LOG_INDEX for that tx).
 *   - Or omit both — this script picks the latest MarketInitialized log on the adapter from config.json
 *     (scans Arc RPC in 10k-block windows backward from chain head).
 *
 * Examples:
 *   yarn resolve
 *   yarn resolve:broadcast
 *   CRE_SIMULATE_MARKET_INIT_TX=0xabc... yarn resolve
 */
"use strict";

const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const { writeSecretsActive } = require("./secrets-active-manifest.cjs");
const { loadLayeredDotEnv, pickGeminiKey } = require("./layered-env.cjs");
const { writeConfigSimRun } = require("./write-config-sim-run.cjs");

const MARKET_INITIALIZED_TOPIC =
  "0xfc494f392f96fcc692b5dbb5e55fa38ce4c322ca25afb09ea64664fd8665e411";

const jobRoot = path.resolve(__dirname, "..");
/** CRE project root (`packages/cre-jobs`) — must match project.yaml + secrets.yaml location for WASM secrets. */
const creProjectRoot = path.resolve(jobRoot, "..");
const workflowFolderName = path.basename(jobRoot);

/** Collect signing-key candidates (files override earlier layers via `merged`). */
function creSigningKeyCandidates(merged) {
  const raw = [
    merged.CRE_ETH_PRIVATE_KEY,
    merged.PRIVATE_KEY,
    merged.DEPLOYER_PRIVATE_KEY,
    process.env.PRIVATE_KEY,
    process.env.DEPLOYER_PRIVATE_KEY,
    process.env.CRE_ETH_PRIVATE_KEY,
  ];
  const seen = new Set();
  const out = [];
  for (const r of raw) {
    const s = String(r || "").trim();
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

/** First candidate that normalizes to a 32-byte hex key wins. */
function pickNormalizedSigningKey(merged) {
  const candidates = creSigningKeyCandidates(merged);
  if (candidates.length === 0) return { key: null, error: null };
  let lastErr = null;
  for (const c of candidates) {
    try {
      return { key: normalizeEthPrivateKey(c), error: null };
    } catch (e) {
      lastErr = e;
    }
  }
  return { key: null, error: lastErr };
}

/** Normalize to `0x` + 64 lowercase hex (256-bit). */
function normalizeEthPrivateKey(raw) {
  let h = String(raw).trim();
  if (!h) throw new Error("Private key is empty.");
  if (h.startsWith("0x") || h.startsWith("0X")) h = h.slice(2);
  if (!/^[0-9a-fA-F]+$/.test(h)) {
    throw new Error(
      "Private key must be hex (optionally 0x-prefixed). Keystore JSON is not supported for CRE_ETH_PRIVATE_KEY."
    );
  }
  if (h.length !== 64) {
    throw new Error(
      `Private key must be 64 hex characters (32 bytes); got ${h.length}. Fix CRE_ETH_PRIVATE_KEY, PRIVATE_KEY, or DEPLOYER_PRIVATE_KEY.`
    );
  }
  return "0x" + h.toLowerCase();
}

/** Escape for KEY=value lines (minimal). */
function dotEnvLine(key, val) {
  const v = String(val);
  if (/[\r\n#]/.test(v)) {
    throw new Error(`${key} contains invalid characters for .env line`);
  }
  if (/[\s'"]/.test(v)) return `${key}="${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"\n`;
  return `${key}=${v}\n`;
}

function writeCreRunEnv(creRoot, geminiKey, normalizedPkOpt) {
  const p = path.join(creRoot, ".env.cre-run");
  let body = dotEnvLine("GEMINI_API_KEY", geminiKey);
  if (normalizedPkOpt) {
    body += dotEnvLine("CRE_ETH_PRIVATE_KEY", normalizedPkOpt);
    body += dotEnvLine("PRIVATE_KEY", normalizedPkOpt);
  }
  fs.writeFileSync(p, body, "utf8");
  return p;
}

function readRpcUrl() {
  const wfPath = path.join(jobRoot, "workflow.yaml");
  try {
    const text = fs.readFileSync(wfPath, "utf8");
    const m = text.match(/chain-name:\s*arc-testnet[\s\S]{0,120}?url:\s*"([^"]+)"/);
    if (m) return m[1];
  } catch {
    /* ignore */
  }
  return "https://rpc.testnet.arc.network";
}

async function rpc(rpcUrl, method, params) {
  const res = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const j = await res.json();
  if (j.error) throw new Error(j.error.message || JSON.stringify(j.error));
  return j.result;
}

async function getLogsChunk(rpcUrl, adapter, fromBlock, toBlock) {
  return rpc(rpcUrl, "eth_getLogs", [
    {
      address: adapter,
      topics: [MARKET_INITIALIZED_TOPIC],
      fromBlock: "0x" + fromBlock.toString(16),
      toBlock: "0x" + toBlock.toString(16),
    },
  ]);
}

/**
 * Latest MarketInitialized on adapter within RPC log-range limits (10k blocks per query).
 */
async function discoverLatestMarketInitTx(rpcUrl, adapter) {
  const latestHex = await rpc(rpcUrl, "eth_blockNumber", []);
  let hi = Number.parseInt(latestHex, 16);
  const adapterLc = adapter.toLowerCase();
  const span = 9_999;

  for (let attempt = 0; attempt < 50 && hi >= 0; attempt++) {
    const lo = Math.max(0, hi - span);
    let logs;
    try {
      logs = await getLogsChunk(rpcUrl, adapterLc, lo, hi);
    } catch (e) {
      throw new Error(`eth_getLogs failed (${lo}-${hi}): ${e.message}`);
    }
    if (logs.length > 0) {
      const last = logs[logs.length - 1];
      return last.transactionHash;
    }
    hi = lo - 1;
  }

  throw new Error(
    "No MarketInitialized logs found for adapter in scanned history. Set CRE_SIMULATE_MARKET_INIT_TX manually " +
      "(Arc explorer → AiCTFAdapter → MarketInitialized)."
  );
}

async function marketInitializedLogIndex(rpcUrl, txHash, adapter) {
  const receipt = await rpc(rpcUrl, "eth_getTransactionReceipt", [txHash]);
  if (!receipt || !receipt.logs) throw new Error(`No receipt for tx ${txHash}`);
  const adapterLc = adapter.toLowerCase();
  const topicLc = MARKET_INITIALIZED_TOPIC.toLowerCase();

  for (let i = 0; i < receipt.logs.length; i++) {
    const log = receipt.logs[i];
    if (
      log.address &&
      log.address.toLowerCase() === adapterLc &&
      log.topics &&
      log.topics[0] &&
      log.topics[0].toLowerCase() === topicLc
    ) {
      return i;
    }
  }

  throw new Error(`No MarketInitialized log in receipt for ${txHash}`);
}

(async () => {
  const configPath = path.join(jobRoot, "config.json");
  const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  const adapter = config.evms[0].adapterAddress;
  const rpcUrl = readRpcUrl();

  let tx = process.env.CRE_SIMULATE_MARKET_INIT_TX;
  if (!tx || !/^0x[0-9a-fA-F]{64}$/.test(tx)) {
    console.error(`Discovering latest MarketInitialized on ${adapter} via ${rpcUrl} …`);
    tx = await discoverLatestMarketInitTx(rpcUrl, adapter);
    console.error(`Using CRE_SIMULATE_MARKET_INIT_TX=${tx}`);
  }

  let eventIndex = process.env.CRE_SIMULATE_MARKET_INIT_LOG_INDEX;
  if (eventIndex === undefined || eventIndex === "") {
    eventIndex = await marketInitializedLogIndex(rpcUrl, tx, adapter);
    console.error(`Using CRE_SIMULATE_MARKET_INIT_LOG_INDEX=${eventIndex}`);
  } else {
    eventIndex = parseInt(String(eventIndex), 10);
    if (Number.isNaN(eventIndex)) {
      console.error("CRE_SIMULATE_MARKET_INIT_LOG_INDEX must be an integer.");
      process.exit(1);
    }
  }

  const broadcast = process.argv.includes("--broadcast");

  writeSecretsActive(jobRoot);

  const layered = loadLayeredDotEnv(jobRoot);
  const gemini = pickGeminiKey(layered);
  if (!gemini) {
    console.error(
      "GEMINI_API_KEY not found. Add it to one of:\n" +
        `  ${path.join(jobRoot, ".env")}\n` +
        `  ${path.join(creProjectRoot, ".env")}\n` +
        `  ${path.join(jobRoot, "..", "..", "hardhat", ".env")}\n` +
        `  ${path.join(jobRoot, "..", "..", "..", ".env")}\n` +
        "(or set GOOGLE_API_KEY / GEMINI_KEY as alias.)"
    );
    process.exit(1);
  }

  let pkNorm = null;
  if (broadcast) {
    const { key, error } = pickNormalizedSigningKey(layered);
    if (!key) {
      if (error) console.error(error.message || error);
      console.error(
        "Broadcast needs a valid 32-byte hex key. Set one of:\n" +
          "  CRE_ETH_PRIVATE_KEY=0x…   (what the `cre` CLI reads)\n" +
          "  PRIVATE_KEY=0x…\n" +
          "  DEPLOYER_PRIVATE_KEY=0x…\n" +
          `Paths searched: repo root, packages/hardhat/.env, packages/cre-jobs/.env, ${path.join(jobRoot, ".env")}`
      );
      process.exit(1);
    }
    pkNorm = key;
  }

  const simConfigPath = writeConfigSimRun(jobRoot, gemini);

  writeCreRunEnv(creProjectRoot, gemini, pkNorm);
  const creEnvPath = path.join(creProjectRoot, ".env.cre-run");
  const childEnv = { ...process.env, GEMINI_API_KEY: gemini };
  if (pkNorm) {
    childEnv.CRE_ETH_PRIVATE_KEY = pkNorm;
    childEnv.PRIVATE_KEY = pkNorm;
  }

  const creEnvAbs = path.resolve(creProjectRoot, ".env.cre-run");
  // Global `--env` must come before subcommands or `cre` ignores it (defaults to `.env` only).
  const args = [
    `--env`,
    creEnvAbs,
    `workflow`,
    `simulate`,
    workflowFolderName,
    `-R`,
    `.`,
    `--target`,
    `local-simulation`,
    `--verbose`,
    `--non-interactive`,
    `--trigger-index`,
    `0`,
    `--evm-event-index`,
    String(eventIndex),
    `--evm-tx-hash`,
    tx,
  ];
  if (broadcast) args.push("--broadcast");

  let exitCode = 1;
  try {
    const result = spawnSync("cre", args, {
      cwd: creProjectRoot,
      stdio: "inherit",
      shell: true,
      env: childEnv,
    });
    exitCode = result.status === null ? 1 : result.status;
  } finally {
    try {
      if (fs.existsSync(simConfigPath)) fs.unlinkSync(simConfigPath);
    } catch {
      /* ignore */
    }
    try {
      if (fs.existsSync(creEnvPath)) fs.unlinkSync(creEnvPath);
    } catch {
      /* ignore */
    }
  }

  process.exit(exitCode);
})().catch(err => {
  console.error(err.message || err);
  process.exit(1);
});
