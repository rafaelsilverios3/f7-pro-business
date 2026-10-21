import { admin, corsHeaders, json } from "../_shared/core.ts";
import {
  companyAccess,
  mpRequest,
  parseOAuthTokens,
  sha256,
  validUuid,
} from "../_shared/mercadoPagoCompany.ts";

async function accountToken(
  sb: ReturnType<typeof admin>,
  companyId: string,
  payment: Record<string, any>,
  record: Record<string, any>,
) {
  const { data: connection, error } = await sb.from("company_mp_connections")
    .select("status,access_token_expires_at")
    .eq("company_id", companyId).eq("id", payment.connection_id).maybeSingle();
  if (error || connection?.status !== "connected") {
    throw new Error("MP_COMPANY_ACCOUNT_DISCONNECTED");
  }
  if (
    Date.parse(String(connection.access_token_expires_at || "")) >
      Date.now() + 60_000 && record.vault_secret?.access_token
  ) return record.vault_secret.access_token;
  const clientId = Deno.env.get("MP_COMPANY_CLIENT_ID") || "";
  const clientSecret = Deno.env.get("MP_COMPANY_CLIENT_SECRET") || "";
  const response = await fetch("https://api.mercadopago.com/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "refresh_token",
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: record.vault_secret?.refresh_token,
    }),
    signal: AbortSignal.timeout(12000),
  });
  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {}
  if (!response.ok) {
    throw new Error(
      response.status === 400 || response.status === 401
        ? "MP_REFRESH_REAUTH_REQUIRED"
        : "MP_REFRESH_RESULT_UNCERTAIN",
    );
  }
  const tokens = parseOAuthTokens(payload);
  if (tokens.seller !== String(record.seller_id)) {
    throw new Error("MP_REFRESH_IDENTITY_MISMATCH");
  }
  const { data: saved, error: saveError } = await sb.rpc(
    "company_mp_refresh_connection",
    {
      p_company: companyId,
      p_access_token: tokens.access,
      p_refresh_token: tokens.refresh,
      p_expires_at: new Date(Date.now() + tokens.expires * 1000).toISOString(),
    },
  );
  if (saveError || saved !== true) throw new Error("MP_REFRESH_PERSIST_FAILED");
  return tokens.access;
}

Deno.serve(async (req) => {
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
  const paymentId = body?.payment_id;
  if (!validUuid(companyId) || !validUuid(paymentId)) {
    return json({ code: "INVALID_PAYLOAD" }, 400);
  }
  const access = await companyAccess(req, companyId, "sales");
  if ("error" in access) return json({ code: access.error }, access.status);
  const { data: payment, error } = await access.viewer.from(
    "company_mp_payments",
  ).select(
    "id,company_id,sale_id,financial_entry_id,connection_id,provider_payment_id,provider_preference_id,provider_status,status,method,amount,currency,installments,pix_qr_code,pix_qr_code_base64,pix_ticket_url,checkout_url,expires_at,fee_amount,net_amount,refunded_amount",
  ).eq("id", paymentId).eq("company_id", companyId).maybeSingle();
  if (error || !payment) return json({ code: "MP_PAYMENT_NOT_FOUND" }, 404);
  if (
    ["approved", "rejected", "cancelled", "expired", "refunded", "charged_back"]
      .includes(payment.status)
  ) return json({ code: "OK", payment });
  const sb = admin();
  try {
    const { data: secured, error: secureError } = await sb.rpc(
      "company_mp_get_payment_server",
      { p_payment: payment.id },
    );
    const record = Array.isArray(secured) ? secured[0] : null;
    if (secureError || !record?.vault_secret?.refresh_token) {
      throw new Error("MP_PAYMENT_RECORD_UNAVAILABLE");
    }
    const token = await accountToken(sb, companyId, payment, record);
    let providerPayment: any = null;
    if (payment.provider_payment_id) {
      providerPayment = (await mpRequest(
        `/v1/payments/${encodeURIComponent(payment.provider_payment_id)}`,
        token,
      )).body;
    } else if (payment.method === "card" && payment.provider_preference_id) {
      const search = await mpRequest(
        `/v1/payments/search?external_reference=${
          encodeURIComponent(payment.id)
        }&sort=date_created&criteria=desc&limit=10`,
        token,
      );
      providerPayment = (search.body.results || []).find((item: any) =>
        String(item.external_reference || "") === payment.id
      ) || null;
    }
    if (!providerPayment) return json({ code: "OK", payment });
    if (
      String(providerPayment.collector_id || "") !== String(record.seller_id) ||
      String(providerPayment.external_reference || "") !== payment.id ||
      Math.round(Number(providerPayment.transaction_amount) * 100) !==
        Math.round(Number(payment.amount) * 100) ||
      String(providerPayment.currency_id).toUpperCase() !== "BRL"
    ) throw new Error("MP_PROVIDER_RESPONSE_MISMATCH");
    const { error: saveError } = await sb.rpc(
      "company_mp_save_payment_provider_result",
      {
        p_payment: payment.id,
        p_company: companyId,
        p_provider_payment: String(providerPayment.id),
        p_preference: "",
        p_provider_status: String(providerPayment.status || "pending"),
        p_pix_qr: "",
        p_pix_base64: "",
        p_pix_ticket: "",
        p_checkout_url: "",
        p_expires_at: providerPayment.date_of_expiration || null,
        p_error: null,
      },
    );
    if (saveError) throw new Error("MP_PAYMENT_PERSIST_FAILED");
    const fee = Array.isArray(providerPayment.fee_details)
      ? providerPayment.fee_details.reduce(
        (sum: number, item: any) => sum + Number(item.amount || 0),
        0,
      )
      : 0;
    const eventKey = await sha256(
      `status:${payment.id}:${providerPayment.id}:${providerPayment.status}:${
        providerPayment.date_last_updated || ""
      }`,
    );
    const { error: applyError } = await sb.rpc(
      "company_mp_apply_provider_status",
      {
        p_payment: payment.id,
        p_company: companyId,
        p_provider_payment: String(providerPayment.id),
        p_provider_status: String(providerPayment.status || "pending"),
        p_amount: Number(providerPayment.transaction_amount),
        p_currency: String(providerPayment.currency_id || ""),
        p_fee: fee,
        p_net: Number(
          providerPayment.transaction_details?.net_received_amount ||
            Math.max(0, Number(providerPayment.transaction_amount) - fee),
        ),
        p_refunded: Number(providerPayment.transaction_amount_refunded || 0),
        p_event_key: eventKey,
      },
    );
    if (applyError) throw new Error("MP_PAYMENT_RECONCILIATION_FAILED");
    const { data: updated } = await access.viewer.from("company_mp_payments")
      .select(
        "id,status,provider_status,method,amount,currency,installments,pix_qr_code,pix_qr_code_base64,pix_ticket_url,checkout_url,expires_at,fee_amount,net_amount,refunded_amount",
      ).eq("id", payment.id).eq("company_id", companyId).maybeSingle();
    return json({ code: "OK", payment: updated || payment });
  } catch (error) {
    const raw = error instanceof Error ? error.message : "";
    const code = /^MP_[A-Z0-9_]{2,64}$/.test(raw)
      ? raw
      : "MP_PAYMENT_STATUS_FAILED";
    return json({ code }, 503);
  }
});
