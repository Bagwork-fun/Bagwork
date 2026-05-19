const HIDDEN_MARKET_IDS = new Set(
  [
    "0x444773326c20095391f93feac9dab432f7cb11ed6987fc69f64317ac55777040",
    "0xb96cb548effcc971712489b5288e911c9d9aceb896ecf6a8c40cea1b9aad4215",
    "0x9fe8fb2ba847aa3da902d913f4a99312bea1921cd7ecf6d3d5d7006fdfe5538d",
  ].map(id => id.toLowerCase()),
);

export function isHiddenMarket(questionId: string): boolean {
  return HIDDEN_MARKET_IDS.has(questionId.toLowerCase());
}

export function filterVisibleMarkets<T extends string>(ids: T[]): T[] {
  return ids.filter(id => !isHiddenMarket(id));
}
