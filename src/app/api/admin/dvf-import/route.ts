import { isAuthorized } from "@/lib/auth/api-token";
import { ingestDepartment, DEFAULT_DVF_YEARS } from "@/lib/dvf/ingest";

// L'ingestion peut prendre plusieurs dizaines de secondes (téléchargement
// + parsing de plusieurs années de CSV, purge + réinsertion) — au-delà du
// timeout par défaut de Vercel. À surveiller au déploiement (#13) : soit
// relever maxDuration selon le plan Vercel, soit passer en traitement
// asynchrone si ça devient un vrai problème en prod.
export const maxDuration = 300;

const DEPARTMENT_PATTERN = /^(2[AB]|\d{2,3})$/i;

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

  const { department, years } = body;
  if (typeof department !== "string" || !DEPARTMENT_PATTERN.test(department)) {
    return Response.json(
      { error: 'department requis (ex: "77", "2A", "971")' },
      { status: 400 }
    );
  }

  let yearsInput: number[] = DEFAULT_DVF_YEARS;
  if (years !== undefined) {
    if (!Array.isArray(years) || !years.every((y) => typeof y === "number" && Number.isInteger(y))) {
      return Response.json({ error: "years doit être un tableau d'entiers" }, { status: 400 });
    }
    yearsInput = years;
  }

  try {
    const result = await ingestDepartment(department, yearsInput);
    return Response.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Échec de l'ingestion DVF";
    return Response.json({ error: message }, { status: 502 });
  }
}
