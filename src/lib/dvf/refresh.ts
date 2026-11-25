import { prisma } from "@/lib/db";
import { availableDvfYears, geoDvfEtag, sourceSignature } from "@/lib/dvf/geodvf";
import { ingestDepartment } from "@/lib/dvf/ingest";

// Départements couverts par Estima (V1 : Île-de-France). Un département
// importé à la main via /api/admin/dvf-import est aussi suivi ensuite.
export const DEFAULT_DEPARTMENTS = ["75", "77", "78", "91", "92", "93", "94", "95"];

export type RefreshStatus = "up-to-date" | "refreshed" | "deferred" | "error";

export interface RefreshReport {
  years: number[];
  departments: { department: string; status: RefreshStatus; count?: number; error?: string }[];
}

// Rafraîchissement automatique du cache DVF (#17), appelé chaque jour par le
// cron. Pour chaque département, compare l'empreinte des fichiers geo-dvf
// (requêtes HEAD, sans téléchargement) à celle du dernier import : seuls les
// départements dont la source a changé sont rechargés — en pratique deux fois
// par an, à chaque publication DGFiP. Au-delà de `budgetMs`, les départements
// restants sont reportés à l'exécution suivante (limite de durée des fonctions).
export async function refreshDvfCache(
  { budgetMs, dryRun = false }: { budgetMs: number; dryRun?: boolean },
  now = new Date()
): Promise<RefreshReport> {
  const start = Date.now();
  const years = await availableDvfYears(now);
  const imports = await prisma.dvfImport.findMany();
  const tracked = [...new Set([...DEFAULT_DEPARTMENTS, ...imports.map((i) => i.department)])].sort();

  const report: RefreshReport = { years, departments: [] };
  for (const department of tracked) {
    try {
      const etags = await Promise.all(years.map(async (year) => ({ year, etag: await geoDvfEtag(department, year) })));
      const previous = imports.find((i) => i.department === department);
      if (previous?.sourceSignature === sourceSignature(etags)) {
        report.departments.push({ department, status: "up-to-date" });
      } else if (dryRun || Date.now() - start > budgetMs) {
        report.departments.push({ department, status: "deferred" });
      } else {
        const result = await ingestDepartment(department, years);
        report.departments.push({ department, status: "refreshed", count: result.count });
      }
    } catch (error) {
      // Une source en panne pour un département n'empêche pas les autres.
      report.departments.push({ department, status: "error", error: error instanceof Error ? error.message : String(error) });
    }
  }
  return report;
}
