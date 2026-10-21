import { corsHeaders, json } from "../_shared/core.ts";
import {
  companyAccess,
  hasConnectorConfig,
  validUuid,
} from "../_shared/mercadoPagoCompany.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") return json({ code: "METHOD_NOT_ALLOWED" }, 405);
  try {
    const body = await req.json();
    const companyId = body?.company_id;
    if (!validUuid(companyId)) return json({ code: "INVALID_PAYLOAD" }, 400);
    // Sales roles need to know if this company's connected receiver is usable
    // before showing online methods in the billing dialog.
    const access = await companyAccess(req, companyId, "sales");
    if ("error" in access) return json({ code: access.error }, access.status);
    const { data, error } = await access.sb.from("company_mp_connections")
      .select(
        "id,seller_id,status,scopes,public_key,connected_at,disconnected_at,access_token_expires_at,last_error_code",
      )
      .eq("company_id", companyId).maybeSingle();
    if (error) return json({ code: "MP_CONNECTION_STATUS_UNAVAILABLE" }, 503);
    const env = (Deno.env.get("MP_COMPANY_ENVIRONMENT") || "").trim()
      .toLowerCase();
    const paymentsEnabled = hasConnectorConfig() &&
      Deno.env.get("MP_COMPANY_PAYMENTS_ENABLED")?.trim().toLowerCase() ===
        "true" &&
      (env === "test" ||
        (env === "production" &&
          Deno.env.get("MP_COMPANY_PRODUCTION_PAYMENTS_ENABLED")?.trim()
              .toLowerCase() === "true"));
    return json({
      code: "OK",
      connector_configured: hasConnectorConfig(),
      payments_enabled: paymentsEnabled,
      environment: ["test", "production"].includes(env)
        ? env
        : "not_configured",
      connection: data || null,
    });
  } catch {
    return json({ code: "MP_CONNECTION_STATUS_UNAVAILABLE" }, 500);
  }
});
