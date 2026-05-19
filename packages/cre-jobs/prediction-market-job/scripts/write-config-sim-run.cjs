"use strict";

const fs = require("fs");
const path = require("path");

/**
 * Local CRE simulate only — merges GEMINI into a temp config so Node sandbox can read it (CLI 1.0.x WASM/Vault gap).
 * Staging/deploy keeps using ./config.json without this field.
 */
function writeConfigSimRun(jobRoot, geminiApiKey) {
  const src = path.join(jobRoot, "config.json");
  const dst = path.join(jobRoot, "config.sim-run.json");
  const cfg = JSON.parse(fs.readFileSync(src, "utf8"));
  const { simulationGeminiApiKey: _strip, ...rest } = cfg;
  fs.writeFileSync(
    dst,
    JSON.stringify({ ...rest, simulationGeminiApiKey: geminiApiKey }, null, 2) + "\n",
    "utf8"
  );
  return dst;
}

module.exports = { writeConfigSimRun };
