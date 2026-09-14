import "dotenv/config";
import { ingestDepartment } from "@/lib/dvf/ingest";

async function main() {
  const departments = process.argv.slice(2);
  if (departments.length === 0) {
    console.error("Usage: tsx scripts/ingest-dvf.ts <departement...>");
    process.exit(1);
  }

  for (const department of departments) {
    const result = await ingestDepartment(department);
    console.log(`${result.department}: ${result.count} transactions (${result.years.join(", ")})`);
  }
}

main();
