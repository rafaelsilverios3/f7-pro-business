import { admin, corsHeaders, json } from "../_shared/core.ts";
import {
  companyAccess,
  hasPaymentConfig,
  mpRequest,
  parseOAuthTokens,
  validUuid,
} from "../_shared/mercadoPagoCompany.ts";

function safeHttpsMercadoPago(value: unknown) {
  if (typeof value !== "string" || value.length > 2048) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" &&
        /(^|\.)mercadopago\.com(\.br)?$/.test(url.hostname)
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}
function safeError(error: unknown) {
  const code = error instanceof Error ? error.message : "";
  return /^MP_[A-Z0-9_]{2,64}$/.test(code) ? code : "MP_PAYMENT_REQUEST_FAILED";
}

async function serverPayment(sb: ReturnType<typeof admin>, paymentId: string) {
  const { data, error } = await sb.rpc("company_mp_get_payment_server", {
    p_payment: paymentId,
  });
  const record = Array.isArray(data) ? data[0] : null;
  if (
    error || !record?.payment || !record?.seller_id ||
    !record?.vault_secret?.refresh_token
  ) throw new Error("MP_PAYMENT_RECORD_UNAVAILABLE");
  const payment = record.payment as Record<string, any>;
  if (!payment.provider_payment_id && !payment.provider_preference_id) {
    throw new Error("MP_PAYMENT_PROVIDER_ID_MISSING");
  }
  return { ...record, payment };
}

async function tokenForPayment(
  sb: ReturnType<typeof admin>,
  payment: Record<string, any>,
  sellerId: string,
  secret: Record<string, string>,
) {
  const { data: connection, error } = await sb.from("company_mp_connections")
    .select("status,access_token_expires_at")
    .eq("id", payment.connection_id).eq("company_id", payment.company_id)
    .maybeSingle();
  if (error || connection?.status !== "connected") {
    throw new Error("MP_COMPANY_ACCOUNT_DISCONNECTED");
  }
  if (
    Date.parse(String(connection.access_token_expires_at || "")) >
      Date.now() + 60_000 && secret.access_token
  ) return secret.access_token;
  const clientId = Deno.env.get("MP_COMPANY_CLIENT_ID") || "";
  const clientSecret = Deno.env.get("MP_COMPANY_CLIENT_SECRET") || "";
  if (!clientId || !clientSecret) {
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
    if (response.status === 400 || response.status === 401) {
      await sb.from("company_mp_connections").update({
        status: "reauthorization_required",
        last_error_code: "MP_REFRESH_REAUTH_REQUIRED",
      }).eq("company_id", payment.company_id);
    }
    throw new Error(
      response.status === 400 || response.status === 401
        ? "MP_REFRESH_REAUTH_REQUIRED"
        : "MP_REFRESH_RESULT_UNCERTAIN",
    );
  }
  const tokens = parseOAuthTokens(payload);
  if (tokens.seller !== sellerId) {
    throw new Error("MP_REFRESH_IDENTITY_MISMATCH");
  }
  const { data: saved, error: saveError } = await sb.rpc(
    "company_mp_refresh_connection",
    {
      p_company: payment.company_id,
      p_access_token: tokens.access,
      p_refresh_token: tokens.refresh,
      p_expires_at: new Date(Date.now() + tokens.expires * 1000).toISOString(),
    },
  );
  if (saveError || saved !== true) throw new Error("MP_REFRESH_PERSIST_FAILED");
  return tokens.access;
}

async function customerForSale(
  sb: ReturnType<typeof admin>,
  sale: Record<string, any>,
) {
  if (!sale.customer_id) throw new Error("MP_PAYER_EMAIL_REQUIRED");
  const { data, error } = await sb.from("customers").select("name,email").eq(
    "id",
    sale.customer_id,
  ).eq("company_id", sale.company_id).maybeSingle();
  if (
    error || !data ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(data.email || ""))
  ) throw new Error("MP_PAYER_EMAIL_REQUIRED");
  return {
    name: String(data.name || "Cliente").slice(0, 120),
    email: String(data.email).trim().toLowerCase(),
  };
}

export async function handleMercadoPagoCompanyPayments(
  req: Request,
  deps: { fetcher?: typeof fetch } = {},
) {
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
  const saleId = body?.sale_id;
  const method = body?.method;
  const installments = Number(body?.installments || 1);
  const idempotency = String(body?.idempotency_key || "");
  if (
    !validUuid(companyId) || !validUuid(saleId) ||
    !["pix", "card"].includes(method) || !Number.isInteger(installments) ||
    installments < 1 || installments > 24 ||
    !/^[A-Za-z0-9_-]{16,100}$/.test(idempotency)
  ) return json({ code: "INVALID_PAYLOAD" }, 400);
  const access = await companyAccess(req, companyId, "sales");
  if ("error" in access) return json({ code: access.error }, access.status);
  if (!hasPaymentConfig()) {
    return json({ code: "MP_COMPANY_PAYMENTS_DISABLED" }, 409);
  }
  const env = (Deno.env.get("MP_COMPANY_ENVIRONMENT") || "").trim()
    .toLowerCase();
  if (!["test", "production"].includes(env)) {
    return json({ code: "MP_COMPANY_ENVIRONMENT_NOT_CONFIGURED" }, 409);
  }
  // Validate the billed sale and payer before creating an intent. A missing
  // customer email must not leave a synthetic pending attempt in the ledger.
  const sb = admin();
  const { data: sale, error: saleError } = await sb.from("sales").select(
    "id,company_id,total,customer_id,status,items",
  ).eq("id", saleId).eq("company_id", companyId).maybeSingle();
  if (saleError || sale?.status !== "completed") {
    return json({ code: "MP_SALE_NOT_BILLED" }, 409);
  }
  if (Number(sale.total) <= 0) {
    return json({ code: "MP_SALE_AMOUNT_MISMATCH" }, 409);
  }
  let payer: { name: string; email: string };
  try {
    payer = await customerForSale(sb, sale);
  } catch {
    return json({ code: "MP_PAYER_EMAIL_REQUIRED" }, 409);
  }
  const { data: payment, error: intentError } = await access.viewer.rpc(
    "company_mp_create_payment_attempt",
    {
      p_company: companyId,
      p_sale: saleId,
      p_method: method,
      p_installments: installments,
      p_idempotency: idempotency,
    },
  );
  if (intentError || !payment?.id) {
    const raw = String(intentError?.message || "");
    const code = [
      "MP_PAYMENT_FORBIDDEN",
      "MP_PAYMENT_INPUT_INVALID",
      "MP_IDEMPOTENCY_KEY_REUSED",
      "MP_PAYMENT_ATTEMPT_PENDING",
      "MP_COMPANY_ACCOUNT_NOT_CONNECTED",
      "MP_SALE_NOT_BILLED",
      "MP_RECEIVABLE_NOT_PAYABLE",
      "MP_PIX_INSTALLMENTS_INVALID",
    ].find((item) => raw.includes(item)) || "MP_PAYMENT_INTENT_FAILED";
    return json({ code }, code === "MP_PAYMENT_FORBIDDEN" ? 403 : 409);
  }
  if (payment.status === "pending" || payment.status === "approved") {
    return json({
      code: "OK",
      payment: {
        id: payment.id,
        status: payment.status,
        method: payment.method,
        amount: payment.amount,
        currency: payment.currency,
        pix_qr_code: payment.pix_qr_code,
        pix_qr_code_base64: payment.pix_qr_code_base64,
        pix_ticket_url: payment.pix_ticket_url,
        checkout_url: payment.checkout_url,
        expires_at: payment.expires_at,
      },
    });
  }
  try {
    const { data: secured, error: secureError } = await sb.rpc(
      "company_mp_get_payment_server",
      { p_payment: payment.id },
    );
    const record = Array.isArray(secured) ? secured[0] : null;
    if (
      secureError || !record?.vault_secret?.refresh_token ||
      record.seller_id === undefined
    ) throw new Error("MP_PAYMENT_RECORD_UNAVAILABLE");
    if (
      Number(sale.total) !== Number(payment.amount)
    ) throw new Error("MP_SALE_AMOUNT_MISMATCH");
    const accountToken = await tokenForPayment(
      sb,
      payment,
      String(record.seller_id),
      record.vault_secret,
    );
    let result: Record<string, any>;
    if (method === "pix") {
      const response = await mpRequest("/v1/payments", accountToken, {
        method: "POST",
        headers: {
          "X-Idempotency-Key": String(payment.id),
          "X-Platform-Id": Deno.env.get("MP_COMPANY_CLIENT_ID") || "",
        },
        body: JSON.stringify({
          transaction_amount: Number(payment.amount),
          description: `Venda F7 ${String(sale.id).slice(0, 8).toUpperCase()}`,
          payment_method_id: "pix",
          payer: { email: payer.email, first_name: payer.name.slice(0, 60) },
          external_reference: payment.id,
          date_of_expiration: new Date(Date.now() + 24 * 60 * 60_000)
            .toISOString(),
        }),
      }, deps.fetcher);
      result = response.body;
      const amount = Number(result.transaction_amount);
      if (
        !result.id || result.external_reference !== payment.id ||
        Math.round(amount * 100) !== Math.round(Number(payment.amount) * 100) ||
        String(result.currency_id).toUpperCase() !== "BRL" ||
        String(result.collector_id || "") !== String(record.seller_id)
      ) throw new Error("MP_PROVIDER_RESPONSE_MISMATCH");
      const { error } = await sb.rpc(
        "company_mp_save_payment_provider_result",
        {
          p_payment: payment.id,
          p_company: companyId,
          p_provider_payment: String(result.id),
          p_preference: "",
          p_provider_status: String(result.status || "pending"),
          p_pix_qr: String(
            result.point_of_interaction?.transaction_data?.qr_code || "",
          ),
          p_pix_base64: String(
            result.point_of_interaction?.transaction_data?.qr_code_base64 || "",
          ),
          p_pix_ticket: safeHttpsMercadoPago(
            result.point_of_interaction?.transaction_data?.ticket_url,
          ),
          p_checkout_url: "",
          p_expires_at: result.date_of_expiration || null,
          p_error: null,
        },
      );
      if (error) throw new Error("MP_PAYMENT_PERSIST_FAILED");
      if (result.status === "approved") {
        await sb.rpc("company_mp_apply_provider_status", {
          p_payment: payment.id,
          p_company: companyId,
          p_provider_payment: String(result.id),
          p_provider_status: "approved",
          p_amount: amount,
          p_currency: result.currency_id,
          p_fee: Number(
            result.fee_details?.reduce?.(
              (sum: number, item: any) => sum + Number(item.amount || 0),
              0,
            ) || 0,
          ),
          p_net: Number(
            result.transaction_details?.net_received_amount || amount,
          ),
          p_refunded: 0,
          p_event_key: `api:${payment.id}:${result.id}`,
        });
      }
      return json({
        code: "OK",
        payment: {
          id: payment.id,
          status: result.status === "approved" ? "approved" : "pending",
          method,
          amount: payment.amount,
          currency: "BRL",
          provider_payment_id: String(result.id),
          pix_qr_code: result.point_of_interaction?.transaction_data?.qr_code ||
            null,
          pix_qr_code_base64:
            result.point_of_interaction?.transaction_data?.qr_code_base64 ||
            null,
          pix_ticket_url: safeHttpsMercadoPago(
            result.point_of_interaction?.transaction_data?.ticket_url,
          ),
          expires_at: result.date_of_expiration || null,
        },
      });
    }
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const preferenceResponse = await mpRequest(
      "/checkout/preferences",
      accountToken,
      {
        method: "POST",
        headers: { "X-Idempotency-Key": String(payment.id) },
        body: JSON.stringify({
          items: [{
            id: String(sale.id),
            title: `Venda F7 ${String(sale.id).slice(0, 8).toUpperCase()}`,
            quantity: 1,
            unit_price: Number(payment.amount),
            currency_id: "BRL",
          }],
          payer: { email: payer.email, name: payer.name },
          external_reference: payment.id,
          notification_url:
            `${supabaseUrl}/functions/v1/mercado-pago-company-webhook`,
          back_urls: {
            success: "https://f7business.com.br/financeiro?mercado_pago=return",
            failure: "https://f7business.com.br/financeiro?mercado_pago=return",
            pending: "https://f7business.com.br/financeiro?mercado_pago=return",
          },
          auto_return: "approved",
          payment_methods: {
            installments,
            excluded_payment_types: [{ id: "pix" }, { id: "ticket" }],
          },
          statement_descriptor: "F7 BUSINESS",
        }),
      },
      deps.fetcher,
    );
    result = preferenceResponse.body;
    const checkoutUrl = safeHttpsMercadoPago(
      result.init_point || (env === "test" ? result.sandbox_init_point : null),
    );
    if (
      !result.id || result.external_reference !== payment.id || !checkoutUrl
    ) throw new Error("MP_PROVIDER_RESPONSE_MISMATCH");
    const { error } = await sb.rpc("company_mp_save_payment_provider_result", {
      p_payment: payment.id,
      p_company: companyId,
      p_provider_payment: "",
      p_preference: String(result.id),
      p_provider_status: "pending",
      p_pix_qr: "",
      p_pix_base64: "",
      p_pix_ticket: "",
      p_checkout_url: checkoutUrl,
      p_expires_at: null,
      p_error: null,
    });
    if (error) throw new Error("MP_PAYMENT_PERSIST_FAILED");
    return json({
      code: "OK",
      payment: {
        id: payment.id,
        status: "pending",
        method,
        amount: payment.amount,
        currency: "BRL",
        provider_preference_id: String(result.id),
        checkout_url: checkoutUrl,
        installments,
      },
    });
  } catch (error) {
    const code = safeError(error);
    await sb.rpc("company_mp_save_payment_provider_result", {
      p_payment: payment.id,
      p_company: companyId,
      p_provider_payment: "",
      p_preference: "",
      p_provider_status: "",
      p_pix_qr: "",
      p_pix_base64: "",
      p_pix_ticket: "",
      p_checkout_url: "",
      p_expires_at: null,
      p_error: code,
    });
    await sb.from("integration_logs").insert({
      company_id: companyId,
      provider: "mercado_pago_company",
      event: "payment_creation_failed",
      status: "error",
      metadata: { safe_error_code: code },
    });
    const status = code === "MP_PROVIDER_UNAVAILABLE" ||
        code === "MP_REFRESH_RESULT_UNCERTAIN"
      ? 503
      : 409;
    return json({ code }, status);
  }
}

if (import.meta.main) {
  Deno.serve((req) => handleMercadoPagoCompanyPayments(req));
}
