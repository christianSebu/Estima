import { prisma } from "@/lib/db";
import type { PropertyType, PropertyCondition } from "@/generated/prisma/client";
import { geocodeAddress } from "@/lib/geocoding/ban";

export interface PropertyInput {
  address: string;
  propertyType: PropertyType;
  surface: number;
  rooms: number;
  floor?: number | null;
  hasElevator?: boolean | null;
  hasOutdoor?: boolean | null;
  hasParking?: boolean | null;
  condition?: PropertyCondition | null;
  dpeClass?: string | null;
  sourceApp: string;
  externalRef?: string | null;
}

// Crée ou retrouve un Property par (sourceApp, externalRef) — spec §5. Un
// bien déjà connu est mis à jour avec les caractéristiques envoyées plutôt
// que renvoyé tel quel : l'appelant peut avoir corrigé une surface, changé
// d'étage déclaré, etc. entre deux appels.
export async function upsertProperty(input: PropertyInput) {
  const geocoded = await geocodeAddress(input.address);

  const data = {
    address: geocoded.label,
    postalCode: geocoded.postalCode,
    city: geocoded.city,
    inseeCode: geocoded.inseeCode,
    latitude: geocoded.latitude,
    longitude: geocoded.longitude,
    propertyType: input.propertyType,
    surface: input.surface,
    rooms: input.rooms,
    floor: input.floor ?? null,
    hasElevator: input.hasElevator ?? null,
    hasOutdoor: input.hasOutdoor ?? null,
    hasParking: input.hasParking ?? null,
    condition: input.condition ?? null,
    dpeClass: input.dpeClass ?? null,
    sourceApp: input.sourceApp,
    externalRef: input.externalRef ?? null,
  };

  if (input.externalRef) {
    const existing = await prisma.property.findFirst({
      where: { sourceApp: input.sourceApp, externalRef: input.externalRef },
    });
    if (existing) {
      return prisma.property.update({ where: { id: existing.id }, data });
    }
  }

  return prisma.property.create({ data });
}
