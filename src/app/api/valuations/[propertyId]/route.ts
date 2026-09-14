import { isAuthorized } from "@/lib/auth/api-token";
import { prisma } from "@/lib/db";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ propertyId: string }> }
) {
  if (!isAuthorized(request)) {
    return Response.json({ error: "Non autorisé" }, { status: 401 });
  }

  const { propertyId } = await params;

  const property = await prisma.property.findUnique({ where: { id: propertyId } });
  if (!property) {
    return Response.json({ error: "Bien introuvable" }, { status: 404 });
  }

  const valuations = await prisma.valuation.findMany({
    where: { propertyId },
    orderBy: { computedAt: "desc" },
  });

  return Response.json({ property, valuations });
}
