import { admin, corsHeaders, json } from "../_shared/core.ts";
import {
  mpRequest,
  parseOAuthTokens,
  sha256,
  validUuid,
  verifyWebhookSignature,
} from "../_shared/mercadoPagoCompany.ts";

async function tokenForConnection(
  sb: ReturnType<typeof admin>,
  connection: Record<string, any>,
  secret: Record<string, string>,
) {
  if (
    Date.parse(String(connection.access_token_expires_at || "")) >
      Date.now() + 60_000 && secret.access_token
  ) return secret.access_token;
  const clientId = Deno.env.get("MP_COMPANY_CLIENT_ID") || "";
  const clientSecret = Deno.env.get("MP_COMPANY_CLIENT_SECRET") || "";
  if (!clientId || !clientSecret || !secret.refresh_token) {
    throw new Error("MP_COMPANY_CONNECTOR_NOT_CONFIGURED");
  }
  const response = await fetch("https://api.mercadopago.com/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      grant_type: "refresh_token",
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: secret.refresh_token,
    }),
    signal: AbortSignal.timeout(12_000),
  });
  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch { /* sanitized */ }
  if (!response.ok) {
    throw new Error(
      response.status === 400 || response.status === 401
        ? "MP_REFRESH_REAUTH_REQUIRED"
        : "MP_REFRESH_RESULT_UNCERTAIN",
    );
  }
  const tokens = parseOAuthTokens(payload);
  if (tokens.seller !== String(connection.seller_id)) {
    throw new Error("MP_REFRESH_IDENTITY_MISMATCH");
  }
  const { data: saved, error } = await sb.rpc("company_mp_refresh_connection", {
    p_company: connection.company_id,
    p_access_token: tokens.access,
    p_refresh_token: tokens.refresh,
    p_expires_at: new Date(Date.now() + tokens.expires * 1000).toISOString(),
  });
  if (error || saved !== true) throw new Error("MP_REFRESH_PERSIST_FAILED");
  return tokens.access;
}

export async function handleMercadoPagoCompanyWebhook(
  req: Request,
  deps: { fetcher?: typeof fetch } = {},
) {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") return json({ code: "METHOD_NOT_ALLOWED" }, 405);
  const signature = req.headers.get("x-signature") || "";
  const requestId = req.headers.get("x-request-id") || "";
  const url = new URL(req.url);
  let body: any = {};
  try {
    body = await req.json();
  } catch { /* query-only notifications are supported */ }
  const dataId = String(
    url.searchParams.get("data.id") || body?.data?.id || "",
  );
  const sellerId = String(body?.user_id || "");
  const secret = Deno.env.get("MP_COMPANY_WEBHOOK_SECRET") || "";
  if (
    !secret || !dataId || !/^\d{3,24}$/.test(sellerId) || !requestId ||
    !(await verifyWebhookSignature({ signature, requestId, dataId, secret }))
  ) return json({ code: "MP_WEBHOOK_SIGNATURE_INVALID" }, 401);
  const notificationType = String(body?.type || body?.topic || "")
    .toLowerCase();
  if (notificationType && !notificationType.startsWith("payment")) {
    return json({ code: "IGNORED" }, 200);
  }

  const sb = admin();
  try {
    const { data: connections, error } = await sb.from("company_mp_connections")
      .select("id,company_id,seller_id,status,access_token_expires_at")
      .eq("seller_id", sellerId).eq("status", "connected").limit(5);
    if (error) throw new Error("MP_CONNECTION_LOOKUP_FAILED");
    if (!connections?.length) return json({ code: "IGNORED" }, 200);
    for (const connection of connections) {
      const { data: secured, error: secretError } = await sb.rpc(
        "company_mp_get_connection_server",
        { p_connection: connection.id },
      );
      const record = Array.isArray(secured) ? secured[0] : null;
      if (secretError || !record?.vault_secret?.refresh_token) continue;
      const storedConnection = record.connection as Record<string, any>;
      const access = await tokenForConnection(
        sb,
        storedConnection,
        record.vault_secret,
      );
      const provider = await mpRequest(
        `/v1/payments/${encodeURIComponent(dataId)}`,
        access,
        {},
        deps.fetcher,
      );
      const payment = provider.body;
      if (
        String(payment.collector_id || "") !== sellerId ||
        !validUuid(payment.external_reference)
      ) continue;
      const transactionId = String(payment.external_reference);
      const { data: ledger, error: ledgerError } = await sb.from(
        "company_mp_payments",
      ).select(
        "id,company_id,connection_id,provider_payment_id,amount,currency",
      )
        .eq("id", transactionId).eq("company_id", connection.company_id)
        .maybeSingle();
      if (ledgerError || !ledger || ledger.connection_id !== connection.id) {
        continue;
      }
      if (
        ledger.provider_payment_id &&
        ledger.provider_payment_id !== String(payment.id)
      ) continue;
      const totalAmount = Number(payment.transaction_amount);
      const fees = Array.isArray(payment.fee_details)
        ? payment.fee_details.reduce(
          (sum: number, item: any) => sum + Number(item.amount || 0),
          0,
        )
        : 0;
      const net = Number(payment.transaction_details?.net_received_amount);
      const { error: saveError } = await sb.rpc(
        "company_mp_save_payment_provider_result",
        {
          p_payment: ledger.id,
          p_company: ledger.company_id,
          p_provider_payment: String(payment.id),
          p_preference: "",
          p_provider_status: String(payment.status || "pending"),
          p_pix_qr: "",
          p_pix_base64: "",
          p_pix_ticket: "",
          p_checkout_url: "",
          p_expires_at: payment.date_of_expiration || null,
          p_error: null,
        },
      );
      if (saveError) throw new Error("MP_PAYMENT_PERSIST_FAILED");
      const eventKey = await sha256(
        `${requestId}:${dataId}:${
          new URLSearchParams(signature.replace(/,/g, "&")).get("ts") || ""
        }`,
      );
      const { data: applied, error: applyError } = await sb.rpc(
        "company_mp_apply_provider_status",
        {
          p_payment: ledger.id,
          p_company: ledger.company_id,
          p_provider_payment: String(payment.id),
          p_provider_status: String(payment.status || "pending"),
          p_amount: totalAmount,
          p_currency: String(payment.currency_id || ""),
          p_fee: Number.isFinite(fees) ? fees : 0,
          p_net: Number.isFinite(net) ? net : Math.max(0, totalAmount - fees),
          p_refunded: Number(payment.transaction_amount_refunded || 0),
          p_event_key: eventKey,
        },
      );
      if (
        applyError || !["OK", "DUPLICATE"].includes(String(applied?.code || ""))
      ) throw new Error("MP_PAYMENT_RECONCILIATION_FAILED");
      await sb.from("integration_logs").insert({
        company_id: ledger.company_id,
        provider: "mercado_pago_company",
        event: "payment_reconciled",
        status: "success",
        metadata: {
          payment_id: ledger.id,
          provider_status: String(payment.status || "pending"),
        },
      });
      return json({ code: "OK" }, 200);
    }
    return json({ code: "IGNORED" }, 200);
  } catch (error) {
    const code =
      error instanceof Error && /^MP_[A-Z0-9_]{2,64}$/.test(error.message)
        ? error.message
        : "MP_WEBHOOK_PROCESSING_FAILED";
    console.error(
      JSON.stringify({
        event: "MP_COMPANY_WEBHOOK_FAILED",
        safe_error_code: code,
      }),
    );
    return json({ code }, 503);
  }
}

if (import.meta.main) Deno.serve((req) => handleMercadoPagoCompanyWebhook(req));
