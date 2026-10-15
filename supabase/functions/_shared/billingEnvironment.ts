/**
 * Prevent a mistaken provider secret/configuration from turning the authorized
 * Supabase homologation project into a live-payment environment.
 */
export const F7_HOMOLOGATION_PROJECT_REF = "vwylnjmapixtzhryiutt";

export function isF7HomologationProject(): boolean {
  const configuredUrl = Deno.env.get("SUPABASE_URL") || "";
  try {
    return new URL(configuredUrl).hostname ===
      `${F7_HOMOLOGATION_PROJECT_REF}.supabase.co`;
  } catch {
    return false;
  }
}

export function blocksLiveBillingInHomologation(environment: string): boolean {
  return isF7HomologationProject() &&
    environment.trim().toLowerCase() === "production";
}

/**
 * Card checkout currently creates a recurring preapproval. Keep that path
 * closed in homologation until its Mercado Pago sandbox contract is verified.
 */
export function blocksRecurringCardInHomologation(method: string): boolean {
  return isF7HomologationProject() && method.trim().toLowerCase() === "card";
}
