import { prisma } from "@/lib/db";
import { availableDvfYears, fetchDvfTransactions, sourceSignature, type DvfTransaction } from "@/lib/dvf/geodvf";

export interface IngestResult {
  department: string;
  years: number[];
  count: number;
}

const BATCH_SIZE = 2000;

// "Rafraîchissement" du cache pour un département : on remplace entièrement
// les transactions déjà en cache pour ce département plutôt que de tenter un
// upsert incrémental (pas d'identifiant stable exposé par geo-dvf côté cache).
// Années par défaut : les dernières publiées (fenêtre glissante, #17).
export async function ingestDepartment(department: string, years?: number[]): Promise<IngestResult> {
  const yearsToLoad = years ?? (await availableDvfYears());
  const transactions: DvfTransaction[] = [];
  const etags: { year: number; etag: string | null }[] = [];
  for (const year of yearsToLoad) {
    const fetched = await fetchDvfTransactions(department, year);
    transactions.push(...fetched.transactions);
    etags.push({ year, etag: fetched.etag });
  }

  // Suppression et réinsertion dans une même transaction (#17) : pendant un
  // rafraîchissement, les estimations continuent de voir l'ancien cache au
  // lieu d'une commune vide.
  await prisma.$transaction(
    async (tx) => {
      await tx.dvfTransactionCache.deleteMany({ where: { inseeCode: { startsWith: department } } });
      for (let i = 0; i < transactions.length; i += BATCH_SIZE) {
        await tx.dvfTransactionCache.createMany({ data: transactions.slice(i, i + BATCH_SIZE) });
      }
      const suivi = { years: yearsToLoad, sourceSignature: sourceSignature(etags), count: transactions.length };
      await tx.dvfImport.upsert({ where: { department }, create: { department, ...suivi }, update: suivi });
    },
    { timeout: 240_000, maxWait: 10_000 }
  );

  return { department, years: yearsToLoad, count: transactions.length };
}
