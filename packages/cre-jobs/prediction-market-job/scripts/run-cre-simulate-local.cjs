/**
 * Interactive local simulate using CRE project layout:
 *   cwd = packages/cre-jobs (project root), workflow = prediction-market-job
 * Requires GEMINI_API_KEY (or alias) in layered .env — same paths as simulate-resolve.cjs.
 */
"use strict";

const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const { writeSecretsActive } = require("./secrets-active-manifest.cjs");
const { loadLayeredDotEnv, pickGeminiKey } = require("./layered-env.cjs");
const { writeConfigSimRun } = require("./write-config-sim-run.cjs");

const jobRoot = path.resolve(__dirname, "..");
const creProjectRoot = path.resolve(jobRoot, "..");
const workflowFolder = path.basename(jobRoot);

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

writeSecretsActive(jobRoot);
const simConfigPath = writeConfigSimRun(jobRoot, gemini);

const envFile = path.resolve(creProjectRoot, ".env");
let exitCode = 1;
try {
  const r = spawnSync(
    "cre",
    [
      "--env",
      envFile,
      "workflow",
      "simulate",
      workflowFolder,
      "-R",
      ".",
      "--target",
      "local-simulation",
      "--verbose",
    ],
    { cwd: creProjectRoot, stdio: "inherit", shell: true }
  );
  exitCode = r.status === null ? 1 : r.status;
} finally {
  try {
    if (fs.existsSync(simConfigPath)) fs.unlinkSync(simConfigPath);
  } catch {
    /* ignore */
  }
}

process.exit(exitCode);
