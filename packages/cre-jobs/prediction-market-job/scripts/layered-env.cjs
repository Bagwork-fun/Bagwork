"use strict";

const fs = require("fs");
const path = require("path");

/** Minimal .env parser (no dependency): BOM-safe, optional `export ` prefix. */
function parseDotEnv(filePath) {
  const out = {};
  if (!fs.existsSync(filePath)) return out;
  let text = fs.readFileSync(filePath, "utf8");
  text = text.replace(/^\uFEFF/, "");
  for (let line of text.split(/\r?\n/)) {
    let t = line.trim();
    if (!t || t.startsWith("#")) continue;
    if (/^export\s+/i.test(t)) t = t.replace(/^export\s+/i, "").trim();
    const eq = t.indexOf("=");
    if (eq === -1) continue;
    const key = t.slice(0, eq).trim().replace(/^\uFEFF/, "");
    let val = t.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

/** Monorepo layers: root → hardhat → cre-jobs → prediction-market-job (last wins). */
function loadLayeredDotEnv(jobRoot) {
  const rootEnv = path.join(jobRoot, "..", "..", "..", ".env");
  const hardhatEnv = path.join(jobRoot, "..", "..", "hardhat", ".env");
  const creJobsEnv = path.join(jobRoot, "..", ".env");
  const localEnv = path.join(jobRoot, ".env");
  return {
    ...parseDotEnv(rootEnv),
    ...parseDotEnv(hardhatEnv),
    ...parseDotEnv(creJobsEnv),
    ...parseDotEnv(localEnv),
  };
}

function pickGeminiKey(merged) {
  return (
    String(merged.GEMINI_API_KEY || "").trim() ||
    String(merged.GOOGLE_API_KEY || "").trim() ||
    String(merged.GEMINI_KEY || "").trim() ||
    String(process.env.GEMINI_API_KEY || "").trim() ||
    String(process.env.GOOGLE_API_KEY || "").trim() ||
    String(process.env.GEMINI_KEY || "").trim()
  );
}

module.exports = { parseDotEnv, loadLayeredDotEnv, pickGeminiKey };
