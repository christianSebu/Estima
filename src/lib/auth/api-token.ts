// Auth inter-services par token simple (spec §1, §5) — pas d'OAuth à ce
// stade, usage interne entre Estima/Locatis/Patrimo.
export function isAuthorized(request: Request): boolean {
  const expected = process.env.API_TOKEN;
  if (!expected) return false;

  const header = request.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) return false;

  return header.slice("Bearer ".length) === expected;
}
