import { isAuthorized } from "@/lib/auth/api-token";
import { prisma } from "@/lib/db";

// Retrouve un bien déjà enregistré depuis l'appli appelante (spec §5,
// §8) : ?sourceApp=locatis&externalRef=xxx. Les deux sont requis — sans
// externalRef la requête serait ambiguë sur tous les biens d'une appli.
export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return Response.json({ error: "Non autorisé" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const sourceApp = searchParams.get("sourceApp");
  const externalRef = searchParams.get("externalRef");

  if (!sourceApp || !externalRef) {
    return Response.json(
      { error: "Paramètres requis : sourceApp, externalRef" },
      { status: 400 }
    );
  }

  const property = await prisma.property.findFirst({ where: { sourceApp, externalRef } });
  if (!property) {
    return Response.json({ error: "Bien introuvable" }, { status: 404 });
  }

  return Response.json({ property });
}
