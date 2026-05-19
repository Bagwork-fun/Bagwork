// types.ts
// Type definitions and config schema for the CTF prediction market CRE workflow.

import { z } from "zod";

/*********************************
 * Config Schema
 *********************************/

const evmConfigSchema = z.object({
  /** CRE chain selector (Arc testnet: "arc-testnet", chain id 5042002) */
  chainSelectorName: z.string().min(1),
  /** Deployed AiCTFAdapter address — also the log trigger source */
  adapterAddress: z
    .string()
    .regex(/^0x[a-fA-F0-9]{40}$/u, "adapterAddress must be a 0x-prefixed 20-byte hex"),
  /** Deployed MarketRegistry address (for reference / frontend) */
  registryAddress: z
    .string()
    .regex(/^0x[a-fA-F0-9]{40}$/u, "registryAddress must be a 0x-prefixed 20-byte hex"),
  /** Gas limit for onReport() call as a numeric string */
  gasLimit: z
    .string()
    .regex(/^\d+$/, "gasLimit must be a numeric string")
    .refine(v => Number(v) > 0, { message: "gasLimit must be > 0" }),
});

export const configSchema = z.object({
  /**
   * Gemini model to use, e.g. "gemini-2.5-flash"
   * Passed to the Gemini API URL inside runInNodeMode().
   */
  geminiModel: z.string().min(1),
  /**
   * Local simulation only: scripts merge this into `config.sim-run.json` so the CLI can supply GEMINI inside the
   * Node sandbox (older CRE CLI builds do not inject Vault/env secrets there). Omit from committed `config.json`.
   */
  simulationGeminiApiKey: z.string().optional(),
  evms: z.array(evmConfigSchema).min(1, "At least one EVM config required"),
});

export type Config = z.infer<typeof configSchema>;

/*********************************
 * Gemini Types
 *********************************/

export interface GeminiResponse {
  statusCode: number;
  rawText: string;      // Full raw text from Gemini (may contain JSON or prose)
  responseId: string;   // Gemini response ID for auditing
}
