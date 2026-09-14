import { prisma } from "@/lib/db";
import { fetchDvfTransactions } from "@/lib/dvf/geodvf";

// Fenêtre de comparables = 24 mois (spec §4) ; on garde une année de plus en
// cache pour rester dense en transactions sur les communes peu actives.
export const DEFAULT_DVF_YEARS = [2023, 2024, 2025];

export interface IngestResult {
  department: string;
  years: number[];
  count: number;
}

// "Rafraîchissement" du cache pour un département : on remplace entièrement
// les transactions déjà en cache pour ce département plutôt que de tenter un
// upsert incrémental (pas d'identifiant stable exposé par geo-dvf côté cache).
export async function ingestDepartment(
  department: string,
  years: number[] = DEFAULT_DVF_YEARS
): Promise<IngestResult> {
  const transactions = [];
  for (const year of years) {
    transactions.push(...(await fetchDvfTransactions(department, year)));
  }

  await prisma.dvfTransactionCache.deleteMany({
    where: { inseeCode: { startsWith: department } },
  });

  const BATCH_SIZE = 2000;
  for (let i = 0; i < transactions.length; i += BATCH_SIZE) {
    await prisma.dvfTransactionCache.createMany({
      data: transactions.slice(i, i + BATCH_SIZE),
    });
  }

  return { department, years, count: transactions.length };
}
