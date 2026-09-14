import type { Comparable } from "@/lib/valuation/comparables";

const PROXIMITY_FULL_WEIGHT_KM = 1;
const PROXIMITY_MAX_KM = 20;
const PROXIMITY_FLOOR_WEIGHT = 0.3;

// Le score sature à 1 à partir de ce nombre de comparables ; en dessous,
// countScore pénalise linéairement. Valeurs à affiner en #12.
const CONFIDENCE_TARGET_COUNT = 15;
// Coefficient de variation (écart-type / moyenne) au-delà duquel la
// dispersion fait tomber le score de confiance à 0.
const CONFIDENCE_MAX_CV = 0.5;

export interface ReferencePriceResult {
  pricePerSqm: number | null;
  confidenceScore: number;
  comparablesUsed: number;
}

// Poids plein jusqu'à 1km, dégressif linéairement jusqu'à un plancher de
// 0.3 à 20km (borne haute de l'élargissement géographique de #4).
function proximityWeight(distanceKm: number): number {
  if (distanceKm <= PROXIMITY_FULL_WEIGHT_KM) return 1;
  const decay =
    (distanceKm - PROXIMITY_FULL_WEIGHT_KM) / (PROXIMITY_MAX_KM - PROXIMITY_FULL_WEIGHT_KM);
  return Math.max(PROXIMITY_FLOOR_WEIGHT, 1 - decay * (1 - PROXIMITY_FLOOR_WEIGHT));
}

function weightedMedian(values: { value: number; weight: number }[]): number | null {
  const totalWeight = values.reduce((sum, v) => sum + v.weight, 0);
  if (totalWeight <= 0) return null;

  const sorted = [...values].sort((a, b) => a.value - b.value);
  let cumulative = 0;
  for (const item of sorted) {
    cumulative += item.weight;
    if (cumulative >= totalWeight / 2) return item.value;
  }
  return sorted[sorted.length - 1].value;
}

function mean(values: number[]): number {
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function stdDev(values: number[], avg: number): number {
  const variance = values.reduce((sum, v) => sum + (v - avg) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

// Score 0-1 basé sur le nombre de comparables (sature à 1 au-delà de
// CONFIDENCE_TARGET_COUNT) et leur dispersion relative — coefficient de
// variation plutôt qu'écart-type brut, pour rester comparable d'un marché
// à l'autre (un écart-type de 500€/m² n'a pas le même sens à Chelles qu'à
// Neuilly).
function computeConfidenceScore(comparables: Comparable[]): number {
  const n = comparables.length;
  if (n === 0) return 0;

  const countScore = Math.min(1, n / CONFIDENCE_TARGET_COUNT);
  if (n === 1) return countScore;

  const prices = comparables.map((c) => c.pricePerSqm);
  const avg = mean(prices);
  const coefficientOfVariation = avg > 0 ? stdDev(prices, avg) / avg : 0;
  const dispersionScore = Math.max(0, 1 - coefficientOfVariation / CONFIDENCE_MAX_CV);

  return countScore * dispersionScore;
}

// Prix/m² de référence = médiane pondérée des comparables (poids =
// récence × proximité géographique), avec un score de confiance dérivé
// du nombre de comparables et de leur dispersion (spec §4, points 3 et 5).
export function computeReferencePrice(comparables: Comparable[]): ReferencePriceResult {
  const weighted = comparables.map((c) => ({
    value: c.pricePerSqm,
    weight: c.recencyWeight * proximityWeight(c.distanceKm),
  }));

  return {
    pricePerSqm: weightedMedian(weighted),
    confidenceScore: computeConfidenceScore(comparables),
    comparablesUsed: comparables.length,
  };
}
