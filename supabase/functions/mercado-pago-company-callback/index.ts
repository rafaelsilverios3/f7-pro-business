import { admin, corsHeaders, json } from "../_shared/core.ts";
import {
  hasOAuthConfig,
  oauthTokenPayload,
  parseOAuthTokens,
  sha256,
  validUuid,
} from "../_shared/mercadoPagoCompany.ts";

function redirectResult(code: string) {
  try {
    const origin = new URL(Deno.env.get("APP_ORIGIN") || "");
    if (
      origin.protocol !== "https:" || origin.username || origin.password ||
      origin.pathname !== "/" || origin.search || origin.hash
    ) throw new Error();
    const target = new URL("/financeiro", origin.origin);
    target.searchParams.set("mercado_pago_connection", code);
    return new Response(null, {
      status: 303,
      headers: {
        Location: target.toString(),
        "Cache-Control": "no-store",
        "Referrer-Policy": "no-referrer",
      },
    });
  } catch {
    return json({ code: "MP_APP_ORIGIN_INVALID" }, 503);
  }
}

export async function handleMercadoPagoCompanyCallback(
  req: Request,
  deps: { fetcher?: typeof fetch } = {},
) {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "GET") return json({ code: "METHOD_NOT_ALLOWED" }, 405);
  const url = new URL(req.url);
  const state = url.searchParams.get("state") || "";
  const code = url.searchParams.get("code") || "";
  if (
    !state || state.length > 100 || code.length > 4096 ||
    url.searchParams.has("error")
  ) return redirectResult("authorization_failed");
  const sb = admin();
  let companyId = "";
  try {
    const { data, error } = await sb.rpc("company_mp_consume_oauth_state", {
      p_state_hash: await sha256(state),
    });
    const oauthState = Array.isArray(data) ? data[0] : null;
    if (
      error || !oauthState?.company_id || !oauthState?.user_id ||
      !oauthState?.pkce_verifier
    ) return redirectResult("authorization_expired");
    companyId = String(oauthState.company_id);
    const { data: member, error: memberError } = await sb.from("company_users")
      .select("role,active").eq("company_id", companyId).eq(
        "user_id",
        oauthState.user_id,
      ).maybeSingle();
    if (
      memberError || member?.active !== true ||
      !["admin", "gestor", "financeiro"].includes(
        String(member.role || "").toLowerCase(),
      )
    ) return redirectResult("access_revoked");
    if (!hasOAuthConfig()) {
      return redirectResult("connector_not_configured");
    }
    const credentials = {
      client_id: Deno.env.get("MP_COMPANY_CLIENT_ID")!.trim(),
      client_secret: Deno.env.get("MP_COMPANY_CLIENT_SECRET")!.trim(),
      grant_type: "authorization_code",
      code,
      redirect_uri: Deno.env.get("MP_COMPANY_REDIRECT_URI")!.trim(),
      code_verifier: oauthState.pkce_verifier,
    };
    const fetcher = deps.fetcher || fetch;
    const tokenResponse = await fetcher(
      "https://api.mercadopago.com/oauth/token",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(oauthTokenPayload(credentials)),
        signal: AbortSignal.timeout(12_000),
      },
    );
    let tokenBody: unknown = null;
    try {
      tokenBody = await tokenResponse.json();
    } catch { /* do not surface body */ }
    if (!tokenResponse.ok) {
      await sb.from("integration_logs").insert({
        company_id: companyId,
        provider: "mercado_pago_company",
        event: "oauth_exchange_failed",
        status: "error",
        metadata: { provider_http_status: tokenResponse.status },
      });
      return redirectResult("authorization_failed");
    }
    const tokens = parseOAuthTokens(tokenBody);
    const profile = await fetcher("https://api.mercadopago.com/users/me", {
      headers: { Authorization: `Bearer ${tokens.access}` },
      signal: AbortSignal.timeout(10_000),
    });
    const profileBody = profile.ok
      ? await profile.json().catch(() => ({}))
      : {};
    if (!profile.ok || String(profileBody?.id || "") !== tokens.seller) {
      return redirectResult("identity_validation_failed");
    }
    const { error: saveError } = await sb.rpc("company_mp_save_connection", {
      p_company: companyId,
      p_seller: tokens.seller,
      p_scopes: tokens.scopes,
      p_public_key: tokens.publicKey,
      p_access_token: tokens.access,
      p_refresh_token: tokens.refresh,
      p_expires_at: new Date(Date.now() + tokens.expires * 1000).toISOString(),
      p_connected_by: oauthState.user_id,
    });
    if (saveError) throw new Error("MP_CONNECTION_SAVE_FAILED");
    await sb.from("integration_logs").insert({
      company_id: companyId,
      provider: "mercado_pago_company",
      event: "oauth_connected",
      status: "success",
      metadata: { seller_id: tokens.seller, vault_storage: true },
    });
    return redirectResult("connected");
  } catch {
    if (validUuid(companyId)) {
      await sb.from("integration_logs").insert({
        company_id: companyId,
        provider: "mercado_pago_company",
        event: "oauth_callback_failed",
        status: "error",
        metadata: { error_code: "MP_CALLBACK_FAILED" },
      });
    }
    return redirectResult("connection_failed");
  }
}

if (import.meta.main) {
  Deno.serve((req) => handleMercadoPagoCompanyCallback(req));
}
