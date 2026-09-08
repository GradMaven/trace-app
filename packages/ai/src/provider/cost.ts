/** Rough EUR cost estimate per model. Approximate list prices, USD→EUR ~0.92. */
const PRICING: Record<string, { inPerM: number; outPerM: number }> = {
  'claude-sonnet-5': { inPerM: 2.76, outPerM: 13.8 },
  'claude-opus-5': { inPerM: 13.8, outPerM: 69 },
  'claude-haiku-4-5': { inPerM: 0.74, outPerM: 3.68 },
  'claude-haiku-4-5-20251001': { inPerM: 0.74, outPerM: 3.68 },
};

export function estimateCostEur(model: string, tokensIn: number, tokensOut: number): number {
  const p = PRICING[model] ?? { inPerM: 3, outPerM: 15 };
  const eur = (tokensIn / 1_000_000) * p.inPerM + (tokensOut / 1_000_000) * p.outPerM;
  return Number(eur.toFixed(6));
}
