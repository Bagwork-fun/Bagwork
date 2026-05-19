const ZERO = "0x0000000000000000000000000000000000000000";

/** Mirrors `AiCTFAdapter._canFinalizeResolution` for UI gating. */
export function canAddressFinalizeResolution(opts: {
  caller?: string;
  owner?: string;
  isMultisigSigner: boolean;
  upkeepFinalizer?: string;
  multisigSignerCount: number;
}): boolean {
  const caller = opts.caller?.toLowerCase();
  if (!caller) return false;
  if (opts.owner && caller === opts.owner.toLowerCase()) return true;
  if (opts.upkeepFinalizer && opts.upkeepFinalizer !== ZERO && caller === opts.upkeepFinalizer.toLowerCase()) {
    return true;
  }
  if (opts.multisigSignerCount > 0 && opts.isMultisigSigner) return true;
  if (opts.multisigSignerCount === 0 && (!opts.upkeepFinalizer || opts.upkeepFinalizer === ZERO)) return true;
  return false;
}
