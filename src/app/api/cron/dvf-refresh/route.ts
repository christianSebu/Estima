import { timingSafeEqual } from "node:crypto";
import { refreshDvfCache } from "@/lib/dvf/refresh";

// Un département se recharge en quelques dizaines de secondes : on n'en
// commence plus de nouveau passé BUDGET_MS, pour finir avant maxDuration.
export const maxDuration = 300;
const BUDGET_MS = 180_000;

// Vercel Cron appelle la route en GET avec « Authorization: Bearer $CRON_SECRET ».
function isCronAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const received = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  return received.length === expected.length && timingSafeEqual(received, expected);
}

// Rafraîchissement automatique du cache DVF (#17) ; ?dryRun=1 indique ce qui
// serait rechargé sans rien modifier.
export async function GET(request: Request) {
  if (!isCronAuthorized(request)) {
    return Response.json({ error: "Non autorisé" }, { status: 401 });
  }
  const dryRun = new URL(request.url).searchParams.get("dryRun") === "1";
  try {
    return Response.json(await refreshDvfCache({ budgetMs: BUDGET_MS, dryRun }));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Échec du rafraîchissement DVF";
    return Response.json({ error: message }, { status: 502 });
  }
}
