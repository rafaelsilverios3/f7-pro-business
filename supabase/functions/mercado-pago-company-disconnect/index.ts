import { admin, corsHeaders, json } from "../_shared/core.ts";
import { companyAccess, validUuid } from "../_shared/mercadoPagoCompany.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") return json({ code: "METHOD_NOT_ALLOWED" }, 405);
  try {
    const body = await req.json();
    const companyId = body?.company_id;
    if (!validUuid(companyId)) return json({ code: "INVALID_PAYLOAD" }, 400);
    const access = await companyAccess(req, companyId, "manage");
    if ("error" in access) return json({ code: access.error }, access.status);
    const { data, error } = await access.viewer.rpc("company_mp_disconnect", {
      p_company: companyId,
    });
    if (error || data !== true) {
      const raw = String(error?.message || "");
      const code = raw.includes("MP_PENDING_PAYMENT_PREVENTS_DISCONNECT")
        ? "MP_PENDING_PAYMENT_PREVENTS_DISCONNECT"
        : "MP_DISCONNECT_FAILED";
      return json({ code }, 409);
    }
    const sb = admin();
    await sb.from("integration_logs").insert({
      company_id: companyId,
      provider: "mercado_pago_company",
      event: "oauth_disconnected",
      status: "success",
      metadata: { local_tokens_revoked: true },
    });
    return json({ code: "OK", local_tokens_revoked: true });
  } catch {
    return json({ code: "MP_DISCONNECT_FAILED" }, 500);
  }
});
