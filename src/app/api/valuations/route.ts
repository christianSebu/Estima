import { isAuthorized } from "@/lib/auth/api-token";
import { GeocodingError } from "@/lib/geocoding/ban";
import { createValuation, InsufficientDataError } from "@/lib/valuation/valuate";
import { PropertyType, PropertyCondition } from "@/generated/prisma/client";

function isPropertyType(value: unknown): value is PropertyType {
  return value === PropertyType.APPARTEMENT || value === PropertyType.MAISON;
}

function isPropertyCondition(value: unknown): value is PropertyCondition {
  return (
    value === PropertyCondition.NEUF ||
    value === PropertyCondition.BON_ETAT ||
    value === PropertyCondition.A_RENOVER
  );
}

export async function POST(request: Request) {
  if (!isAuthorized(request)) {
    return Response.json({ error: "Non autorisé" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "JSON invalide" }, { status: 400 });
  }

  const { address, propertyType, surface, rooms, sourceApp } = body;
  if (
    typeof address !== "string" ||
    !address.trim() ||
    !isPropertyType(propertyType) ||
    typeof surface !== "number" ||
    surface <= 0 ||
    typeof rooms !== "number" ||
    rooms <= 0 ||
    typeof sourceApp !== "string" ||
    !sourceApp.trim()
  ) {
    return Response.json(
      { error: "Champs requis manquants ou invalides : address, propertyType, surface, rooms, sourceApp" },
      { status: 400 }
    );
  }

  if (body.condition !== undefined && body.condition !== null && !isPropertyCondition(body.condition)) {
    return Response.json({ error: "condition invalide" }, { status: 400 });
  }

  try {
    const { property, valuation } = await createValuation({
      address,
      propertyType,
      surface,
      rooms,
      floor: typeof body.floor === "number" ? body.floor : null,
      hasElevator: typeof body.hasElevator === "boolean" ? body.hasElevator : null,
      hasOutdoor: typeof body.hasOutdoor === "boolean" ? body.hasOutdoor : null,
      hasParking: typeof body.hasParking === "boolean" ? body.hasParking : null,
      condition: isPropertyCondition(body.condition) ? body.condition : null,
      dpeClass: typeof body.dpeClass === "string" ? body.dpeClass : null,
      sourceApp,
      externalRef: typeof body.externalRef === "string" ? body.externalRef : null,
    });

    return Response.json({ property, valuation }, { status: 201 });
  } catch (error) {
    if (error instanceof GeocodingError) {
      return Response.json({ error: error.message }, { status: 422 });
    }
    if (error instanceof InsufficientDataError) {
      return Response.json({ error: error.message }, { status: 422 });
    }
    throw error;
  }
}
