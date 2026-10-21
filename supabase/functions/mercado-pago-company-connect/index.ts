import { admin, corsHeaders, json } from "../_shared/core.ts";
import {
  base64Url,
  companyAccess,
  hasConnectorConfig,
  makeAuthorizationUrl,
  pkceChallenge,
  sha256,
  validUuid,
} from "../_shared/mercadoPagoCompany.ts";

export async function handleMercadoPagoCompanyConnect(req: Request) {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") return json({ code: "METHOD_NOT_ALLOWED" }, 405);
  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ code: "INVALID_PAYLOAD" }, 400);
  }
  const companyId = body?.company_id;
  if (!validUuid(companyId)) return json({ code: "INVALID_PAYLOAD" }, 400);
  const access = await companyAccess(req, companyId, "manage");
  if ("error" in access) return json({ code: access.error }, access.status);
  if (!hasConnectorConfig()) {
    return json({ code: "MP_COMPANY_CONNECTOR_NOT_CONFIGURED" }, 503);
  }
  try {
    const state = base64Url(crypto.getRandomValues(new Uint8Array(32)));
    const verifier = base64Url(crypto.getRandomValues(new Uint8Array(48)));
    const challenge = await pkceChallenge(verifier);
    const { data: created, error } = await access.sb.rpc(
      "company_mp_create_oauth_state",
      {
        p_company: companyId,
        p_state_hash: await sha256(state),
        p_pkce_verifier: verifier,
      },
    );
    if (error || created !== true) {
      return json({ code: "MP_OAUTH_STATE_CREATE_FAILED" }, 500);
    }
    const service = admin();
    await service.from("company_mp_oauth_states").delete().lt(
      "expires_at",
      new Date().toISOString(),
    );
    await access.sb.from("integration_logs").insert({
      company_id: companyId,
      provider: "mercado_pago_company",
      event: "oauth_authorization_started",
      status: "success",
      metadata: { pkce: true },
    });
    return json({
      code: "OK",
      authorization_url: makeAuthorizationUrl(state, challenge),
      expires_in_seconds: 600,
    });
  } catch {
    return json({ code: "MP_OAUTH_START_FAILED" }, 500);
  }
}

if (import.meta.main) Deno.serve(handleMercadoPagoCompanyConnect);
