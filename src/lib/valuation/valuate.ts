import { prisma } from "@/lib/db";
import { selectComparables } from "@/lib/valuation/comparables";
import { computeReferencePrice } from "@/lib/valuation/pricing";
import { computeAdjustmentMultiplier } from "@/lib/valuation/adjustments";
import { upsertProperty, type PropertyInput } from "@/lib/valuation/property";

// Bump si l'algo change de façon significative (traçabilité, spec §3).
export const VALUATION_METHODOLOGY = "v1";

export class InsufficientDataError extends Error {}

// Assemble le pipeline complet (spec §4, point 6) : géocodage -> Property
// -> sélection des comparables -> prix/m² de référence -> ajustements ->
// Valuation persistée.
export async function createValuation(input: PropertyInput) {
  const property = await upsertProperty(input);

  const comparables = await selectComparables({
    inseeCode: property.inseeCode,
    latitude: property.latitude,
    longitude: property.longitude,
    propertyType: property.propertyType,
    surface: property.surface,
  });

  const { pricePerSqm: referencePricePerSqm, confidenceScore, comparablesUsed } =
    computeReferencePrice(comparables);

  if (referencePricePerSqm === null) {
    throw new InsufficientDataError(
      `Aucune donnée DVF disponible pour ce secteur (commune ${property.inseeCode})`
    );
  }

  const { multiplier } = computeAdjustmentMultiplier({
    floor: property.floor,
    hasElevator: property.hasElevator,
    hasOutdoor: property.hasOutdoor,
    hasParking: property.hasParking,
    condition: property.condition,
  });

  const adjustedPricePerSqm = referencePricePerSqm * multiplier;
  const estimatedValue = adjustedPricePerSqm * property.surface;

  const valuation = await prisma.valuation.create({
    data: {
      propertyId: property.id,
      estimatedValue,
      pricePerSqm: adjustedPricePerSqm,
      confidenceScore,
      comparablesUsed,
      methodology: VALUATION_METHODOLOGY,
    },
  });

  return { property, valuation };
}
