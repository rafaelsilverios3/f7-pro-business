/** Supabase project officially designated as F7 PRO Business production. */
export const F7_PRODUCTION_PROJECT_REF = "vwylnjmapixtzhryiutt";

export function isF7ProductionProject(): boolean {
  const configuredUrl = Deno.env.get("SUPABASE_URL") || "";
  try {
    return new URL(configuredUrl).hostname ===
      `${F7_PRODUCTION_PROJECT_REF}.supabase.co`;
  } catch {
    return false;
  }
}

/**
 * Allow only production credentials on the designated production project and
 * only test credentials everywhere else. This prevents both live payments in
 * previews/homologation and sandbox events from touching the production DB.
 */
export function blocksBillingEnvironmentMismatch(environment: string): boolean {
  const normalized = environment.trim().toLowerCase();
  return isF7ProductionProject()
    ? normalized !== "production"
    : normalized === "production";
}

/** Keep recurring billing in the same isolated environment as its project. */
export function blocksRecurringEnvironmentMismatch(model: string, environment: string): boolean {
  if (model.trim().toLowerCase() !== "recurring") return false;
  const normalized = environment.trim().toLowerCase();
  return isF7ProductionProject()
    ? normalized !== "production"
    : normalized !== "test";
}
