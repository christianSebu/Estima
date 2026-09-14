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

async function downloadGeoDvfCsv(department: string, year: number): Promise<string> {
  const url = `${GEO_DVF_BASE_URL}/${year}/departements/${department}.csv.gz`;
  const response = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!response.ok) {
    throw new Error(`Téléchargement geo-dvf échoué (département ${department}, ${year}) : ${response.status}`);
  }
  const gzipped = Buffer.from(await response.arrayBuffer());
  return gunzipSync(gzipped).toString("utf-8");
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

export async function fetchDvfTransactions(department: string, year: number): Promise<DvfTransaction[]> {
  const csv = await downloadGeoDvfCsv(department, year);
  return parseDvfTransactions(csv);
}
