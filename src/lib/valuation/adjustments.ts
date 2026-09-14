import { PropertyCondition } from "@/generated/prisma/enums";

// Seuil à partir duquel un étage est considéré "élevé" (spec §4, point 4).
// Valeur non précisée par la spec — 4e étage et au-delà, à recalibrer en #12.
const HIGH_FLOOR_THRESHOLD = 4;

// Chaque coefficient reprend le milieu de la fourchette donnée par la spec
// (ex: étage élevé sans ascenseur -3 à -5% -> -4%). À affiner en #12.
//
// L'ajustement extérieur ne varie pas avec la surface extérieure comme le
// suggère la spec : le schéma Property ne capture qu'un booléen
// `hasOutdoor` (pas de surface dédiée), donc valeur fixe au milieu de la
// fourchette (+3 à +8% -> +5%).
//
// DPE volontairement absent : la roadmap V1 (spec §7) exclut explicitement
// l'ajustement DPE ("sans DPE"), prévu en V2 (ticket #16).
const COEFFICIENTS = {
  highFloorNoElevator: -0.04,
  highFloorWithElevator: 0.02,
  outdoor: 0.05,
  parking: 0.035,
  needsRenovation: -0.125,
} as const;

export interface AdjustmentInput {
  floor?: number | null;
  hasElevator?: boolean | null;
  hasOutdoor?: boolean | null;
  hasParking?: boolean | null;
  condition?: PropertyCondition | null;
}

export interface AdjustmentFactor {
  factor: keyof typeof COEFFICIENTS;
  rate: number;
}

export interface AdjustmentResult {
  multiplier: number;
  factors: AdjustmentFactor[];
}

// Combine les coefficients multiplicativement : (1+r1)*(1+r2)*... plutôt
// qu'une somme des taux, pour rester cohérent même si plusieurs facteurs
// négatifs se cumulent (une somme brute pourrait descendre sous -100%).
export function computeAdjustmentMultiplier(input: AdjustmentInput): AdjustmentResult {
  const factors: AdjustmentFactor[] = [];

  if (input.floor != null && input.floor >= HIGH_FLOOR_THRESHOLD) {
    factors.push(
      input.hasElevator
        ? { factor: "highFloorWithElevator", rate: COEFFICIENTS.highFloorWithElevator }
        : { factor: "highFloorNoElevator", rate: COEFFICIENTS.highFloorNoElevator }
    );
  }

  if (input.hasOutdoor) {
    factors.push({ factor: "outdoor", rate: COEFFICIENTS.outdoor });
  }

  if (input.hasParking) {
    factors.push({ factor: "parking", rate: COEFFICIENTS.parking });
  }

  if (input.condition === PropertyCondition.A_RENOVER) {
    factors.push({ factor: "needsRenovation", rate: COEFFICIENTS.needsRenovation });
  }

  const multiplier = factors.reduce((acc, item) => acc * (1 + item.rate), 1);
  return { multiplier, factors };
}
