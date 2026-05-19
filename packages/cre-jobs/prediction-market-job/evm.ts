// evm.ts
// On-chain submission is handled directly in main.ts via submitResolution().
// This file is kept as a stub for clarity and is not imported by main.ts.
//
// The correct pattern (from Domino reference):
//   1. encodeAbiParameters(questionId, payouts)  — viem
//   2. runtime.report({ encodedPayload: hexToBase64(data), ... })  — DON level
//   3. evmClient.writeReport(runtime, { receiver: adapterAddress, ... })  — DON level
//
// No private key needed — the CRE DON handles signing.
