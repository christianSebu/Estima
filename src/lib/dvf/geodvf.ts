import { gunzipSync } from "node:zlib";
import { parse } from "csv-parse/sync";
import { PropertyType } from "@/generated/prisma/client";

const GEO_DVF_BASE_URL = "https://files.data.gouv.fr/geo-dvf/latest/csv";

interface GeoDvfRow {
  id_mutation: string;
  date_mutation: string;
  nature_mutation: string;
  valeur_fonciere: string;
  code_commune: string;
  id_parcelle: string;
  type_local: string;
  surface_reelle_bati: string;
  longitude: string;
  latitude: string;
}

export interface DvfTransaction {
  inseeCode: string;
  section: string | null;
  propertyType: PropertyType;
  surface: number;
  price: number;
  pricePerSqm: number;
  transactionDate: Date;
  latitude: number;
  longitude: number;
}

const geoDvfUrl = (department: string, year: number) => `${GEO_DVF_BASE_URL}/${year}/departements/${department}.csv.gz`;

async function downloadGeoDvfCsv(department: string, year: number): Promise<{ csv: string; etag: string | null }> {
  const response = await fetch(geoDvfUrl(department, year), { signal: AbortSignal.timeout(60_000) });
  if (!response.ok) {
    throw new Error(`Téléchargement geo-dvf échoué (département ${department}, ${year}) : ${response.status}`);
  }
  const gzipped = Buffer.from(await response.arrayBuffer());
  return { csv: gunzipSync(gzipped).toString("utf-8"), etag: response.headers.get("etag") };
}

// ETag du fichier geo-dvf d'un département pour une année (#17), sans le
// télécharger : il change à chaque republication. null si l'année n'est pas
// (encore) publiée.
export async function geoDvfEtag(department: string, year: number): Promise<string | null> {
  const response = await fetch(geoDvfUrl(department, year), { method: "HEAD", signal: AbortSignal.timeout(15_000) });
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`Vérification geo-dvf échouée (département ${department}, ${year}) : ${response.status}`);
  }
  return response.headers.get("etag");
}

// Nombre d'années gardées en cache : fenêtre de comparables de 24 mois
// (spec §4) + une année de marge pour les communes peu actives.
export const DVF_WINDOW_YEARS = 3;
const REFERENCE_DEPARTMENT = "75";

// Les 3 dernières années publiées par geo-dvf, à la date donnée. La DGFiP
// publie deux fois par an : l'année N n'apparaît qu'en cours d'année N+1.
export async function availableDvfYears(now = new Date()): Promise<number[]> {
  for (let latest = now.getUTCFullYear(); latest > now.getUTCFullYear() - 3; latest--) {
    if (await geoDvfEtag(REFERENCE_DEPARTMENT, latest)) {
      return Array.from({ length: DVF_WINDOW_YEARS }, (_, i) => latest - DVF_WINDOW_YEARS + 1 + i);
    }
  }
  throw new Error("Aucune année DVF publiée trouvée sur geo-dvf");
}

// Empreinte des fichiers source d'un département : « année:etag » par année.
export function sourceSignature(etags: { year: number; etag: string | null }[]): string {
  return etags.map(({ year, etag }) => `${year}:${etag ?? "absent"}`).join(",");
}

// Format id_parcelle DGFiP : code commune (5) + code préfixe (3) + section (2) + numéro (4) = 14 caractères.
function extractSection(idParcelle: string): string | null {
  if (idParcelle.length !== 14) return null;
  return idParcelle.slice(8, 10);
}

// Ne garde que les mutations de type "Vente" ne comportant qu'un seul lot
// habitation (appartement ou maison) — évite de fausser le prix/m² avec des
// mutations multi-biens (ex: achat groupé de plusieurs appartements) où
// valeur_fonciere représente le total et pas le prix d'un lot individuel.
export function parseDvfTransactions(csv: string): DvfTransaction[] {
  const rows = parse(csv, { columns: true, skip_empty_lines: true }) as GeoDvfRow[];

  const byMutation = new Map<string, GeoDvfRow[]>();
  for (const row of rows) {
    const group = byMutation.get(row.id_mutation);
    if (group) group.push(row);
    else byMutation.set(row.id_mutation, [row]);
  }

  const transactions: DvfTransaction[] = [];
  for (const group of byMutation.values()) {
    if (group[0].nature_mutation !== "Vente") continue;

    const residential = group.filter(
      (row) => row.type_local === "Appartement" || row.type_local === "Maison"
    );
    if (residential.length !== 1) continue;

    const row = residential[0];
    const surface = Number(row.surface_reelle_bati);
    const price = Number(row.valeur_fonciere);
    const latitude = Number(row.latitude);
    const longitude = Number(row.longitude);
    if (!surface || !price || !Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      continue;
    }

    transactions.push({
      inseeCode: row.code_commune,
      section: extractSection(row.id_parcelle),
      propertyType: row.type_local === "Appartement" ? PropertyType.APPARTEMENT : PropertyType.MAISON,
      surface,
      price,
      pricePerSqm: price / surface,
      transactionDate: new Date(row.date_mutation),
      latitude,
      longitude,
    });
  }

  return transactions;
}

export async function fetchDvfTransactions(
  department: string,
  year: number
): Promise<{ transactions: DvfTransaction[]; etag: string | null }> {
  const { csv, etag } = await downloadGeoDvfCsv(department, year);
  return { transactions: parseDvfTransactions(csv), etag };
}
