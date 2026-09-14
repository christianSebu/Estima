import { prisma } from "@/lib/db";
import { PropertyType } from "@/generated/prisma/client";

const COMPARABLE_WINDOW_MONTHS = 24;
const RECENCY_THRESHOLD_MONTHS = 12;
const RECENCY_FLOOR_WEIGHT = 0.3;
const SURFACE_TOLERANCE = 0.2;
const MIN_COMPARABLES = 5;
// L'API commune de l'Etat n'expose plus d'adjacence administrative
// (champ "limitrophes" retiré de geo.api.gouv.fr) — on élargit donc par
// rayon géographique croissant plutôt que par vraie commune limitrophe,
// en s'appuyant sur les lat/lon déjà en cache DVF.
const WIDEN_RADII_KM = [3, 5, 8, 12, 20];

export interface ComparableSelectionInput {
  inseeCode: string;
  latitude: number;
  longitude: number;
  propertyType: PropertyType;
  surface: number;
  referenceDate?: Date;
}

export interface Comparable {
  id: string;
  inseeCode: string;
  price: number;
  surface: number;
  pricePerSqm: number;
  transactionDate: Date;
  distanceKm: number;
  recencyWeight: number;
}

function monthsBetween(from: Date, to: Date): number {
  return (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth());
}

// Poids plein jusqu'à 12 mois, dégressif linéairement jusqu'à un plancher
// de 0.3 à 24 mois (bornes de la spec §4, point 2 — valeurs à affiner lors
// du calibrage sur des biens réels, ticket #12).
function recencyWeight(transactionDate: Date, referenceDate: Date): number {
  const monthsAgo = monthsBetween(transactionDate, referenceDate);
  if (monthsAgo <= RECENCY_THRESHOLD_MONTHS) return 1;
  const decay =
    (monthsAgo - RECENCY_THRESHOLD_MONTHS) / (COMPARABLE_WINDOW_MONTHS - RECENCY_THRESHOLD_MONTHS);
  return Math.max(RECENCY_FLOOR_WEIGHT, 1 - decay * (1 - RECENCY_FLOOR_WEIGHT));
}

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function boundingBox(lat: number, lon: number, radiusKm: number) {
  const latDelta = radiusKm / 111;
  const lonDelta = radiusKm / (111 * Math.cos(toRad(lat)));
  return {
    minLat: lat - latDelta,
    maxLat: lat + latDelta,
    minLon: lon - lonDelta,
    maxLon: lon + lonDelta,
  };
}

interface DistancedRow {
  id: string;
  inseeCode: string;
  price: number;
  surface: number;
  pricePerSqm: number;
  transactionDate: Date;
  latitude: number;
  longitude: number;
  distanceKm: number;
}

async function queryByRadius(
  input: ComparableSelectionInput,
  radiusKm: number,
  cutoff: Date,
  minSurface: number,
  maxSurface: number
): Promise<DistancedRow[]> {
  const bbox = boundingBox(input.latitude, input.longitude, radiusKm);
  const rows = await prisma.dvfTransactionCache.findMany({
    where: {
      propertyType: input.propertyType,
      surface: { gte: minSurface, lte: maxSurface },
      transactionDate: { gte: cutoff },
      latitude: { gte: bbox.minLat, lte: bbox.maxLat },
      longitude: { gte: bbox.minLon, lte: bbox.maxLon },
    },
  });
  return rows
    .map((row) => ({
      ...row,
      distanceKm: haversineKm(input.latitude, input.longitude, row.latitude, row.longitude),
    }))
    .filter((row) => row.distanceKm <= radiusKm);
}

// Sélectionne les transactions DVF comparables à un bien : même commune,
// même type, surface ±20%, transaction <24 mois. Élargit géographiquement
// si moins de 5 comparables trouvés dans la commune (spec §4, point 2).
export async function selectComparables(input: ComparableSelectionInput): Promise<Comparable[]> {
  const referenceDate = input.referenceDate ?? new Date();
  const cutoff = new Date(referenceDate);
  cutoff.setMonth(cutoff.getMonth() - COMPARABLE_WINDOW_MONTHS);
  const minSurface = input.surface * (1 - SURFACE_TOLERANCE);
  const maxSurface = input.surface * (1 + SURFACE_TOLERANCE);

  const sameCommune = await prisma.dvfTransactionCache.findMany({
    where: {
      inseeCode: input.inseeCode,
      propertyType: input.propertyType,
      surface: { gte: minSurface, lte: maxSurface },
      transactionDate: { gte: cutoff },
    },
  });

  let rows: DistancedRow[] = sameCommune.map((row) => ({
    ...row,
    distanceKm: haversineKm(input.latitude, input.longitude, row.latitude, row.longitude),
  }));

  if (rows.length < MIN_COMPARABLES) {
    for (const radiusKm of WIDEN_RADII_KM) {
      const widened = await queryByRadius(input, radiusKm, cutoff, minSurface, maxSurface);
      if (widened.length > rows.length) rows = widened;
      if (rows.length >= MIN_COMPARABLES) break;
    }
  }

  return rows.map((row) => ({
    id: row.id,
    inseeCode: row.inseeCode,
    price: row.price,
    surface: row.surface,
    pricePerSqm: row.pricePerSqm,
    transactionDate: row.transactionDate,
    distanceKm: row.distanceKm,
    recencyWeight: recencyWeight(row.transactionDate, referenceDate),
  }));
}
