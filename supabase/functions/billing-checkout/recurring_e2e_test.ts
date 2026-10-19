import { createClient } from "https://esm.sh/@supabase/supabase-js@2.115.0";
import { handleBillingCheckoutRequest } from "./index.ts";
import { handleBillingWebhookRequest } from "../billing-webhook/index.ts";
import { handleBillingSubscriptionManageRequest } from "../billing-subscription-manage/index.ts";

const baseUrl = Deno.env.get("SUPABASE_URL") || "";
const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || "";
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const dbContainer = Deno.env.get("E2E_DB_CONTAINER") || "";
const local = new URL(baseUrl);
if (
  !["localhost", "127.0.0.1", "[::1]"].includes(local.hostname) || !anonKey ||
  !serviceKey || !dbContainer
) {
  throw new Error(
    "Recurring billing E2E requires an explicitly configured local-only Supabase stack.",
  );
}

const admin = createClient(baseUrl, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const previousEnv = new Map(
  [
    "MERCADO_PAGO_ENVIRONMENT",
    "MERCADO_PAGO_PRODUCTION_PAYMENTS_ENABLED",
    "MERCADO_PAGO_ACCESS_TOKEN",
    "MERCADO_PAGO_WEBHOOK_SECRET",
    "APP_URL",
    "APP_ORIGIN",
  ].map((key) => [key, Deno.env.get(key)]),
);
const createdUsers: string[] = [];
const createdCompanies: string[] = [];
const createdEvents: string[] = [];
let priorPlan: {
  price_minor: number | null;
  currency: string;
  billing_period: string;
  active: boolean;
} | null = null;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function localSql(sql: string): Promise<string> {
  const result = await new Deno.Command("docker", {
    args: [
      "exec",
      dbContainer,
      "psql",
      "-X",
      "-v",
      "ON_ERROR_STOP=1",
      "-U",
      "postgres",
      "-d",
      "postgres",
      "-Atc",
      sql,
    ],
    stdout: "piped",
    stderr: "piped",
  }).output();
  if (result.code !== 0) {
    throw new Error("Local recurring billing database assertion failed.");
  }
  return new TextDecoder().decode(result.stdout).trim();
}

async function makeUser(label: string) {
  const nonce = crypto.randomUUID();
  const email = `billing-recurring-${label}-${nonce}@example.invalid`;
  const password = `${crypto.randomUUID()}!Aa9`;
  const created = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (created.error || !created.data.user) {
    throw new Error("Local recurring billing Auth fixture creation failed.");
  }
  createdUsers.push(created.data.user.id);
  const client = createClient(baseUrl, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const session = await client.auth.signInWithPassword({ email, password });
  if (session.error || !session.data.session) {
    throw new Error("Local recurring billing Auth session failed.");
  }
  const company = await client.rpc("create_company_with_owner", {
    company_name: `Recurring Billing E2E ${label} ${nonce.slice(0, 8)}`,
  });
  if (company.error || !company.data?.id) {
    throw new Error("Local recurring billing company fixture failed.");
  }
  createdCompanies.push(company.data.id);
  return {
    id: created.data.user.id,
    companyId: company.data.id as string,
    jwt: session.data.session.access_token,
    client,
  };
}

function signedRequest(
  type: string,
  eventId: string,
  resourceId: string,
  secret: string,
) {
  const requestId = crypto.randomUUID();
  const timestamp = String(Math.floor(Date.now() / 1000));
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  )
    .then((key) =>
      crypto.subtle.sign(
        "HMAC",
        key,
        new TextEncoder().encode(
          `id:${resourceId};request-id:${requestId};ts:${timestamp};`,
        ),
      )
    )
    .then((bytes) => {
      const digest = [...new Uint8Array(bytes)].map((value) =>
        value.toString(16).padStart(2, "0")
      ).join("");
      return new Request(
        `http://127.0.0.1/functions/v1/billing-webhook?data.id=${
          encodeURIComponent(resourceId)
        }`,
        {
          method: "POST",
          headers: {
            "x-request-id": requestId,
            "x-signature": `ts=${timestamp},v1=${digest}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            id: eventId,
            type,
            live_mode: false,
            data: { id: resourceId },
          }),
        },
      );
    });
}

Deno.test("Billing recurring: checkout, authorization, settlement, tenant access, pause, resume and cancel", async () => {
  const webhookSecret = "local-only-recurring-webhook-secret";
  const providerSubscriptionId = `subscription-${crypto.randomUUID()}`;
  let checkoutExternalReference = "";
  const providerPayments = new Set<string>();
  const calls: Array<{ method: string; path: string }> = [];
  let providerSubscriptionStatus = "pending";
  const providerFetch: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    calls.push({ method: init?.method || "GET", path: url.pathname });
    if (url.origin === "https://api.mercadolibre.com" && url.pathname === "/users/me") {
      return Response.json({ id: 987654321, site_id: "MLB", tags: ["test_user"] });
    }
    if (url.origin !== "https://api.mercadopago.com") {
      throw new Error("Unexpected provider host in local test.");
    }
    if (url.pathname === "/preapproval" && init?.method === "POST") {
      const body = JSON.parse(String(init.body || "{}"));
      checkoutExternalReference = String(body.external_reference || "");
      return Response.json({
        id: providerSubscriptionId,
        status: "pending",
        external_reference: checkoutExternalReference,
        init_point: "https://www.mercadopago.com.br/subscriptions/checkout",
      }, { status: 201 });
    }
    if (
      url.pathname === `/preapproval/${providerSubscriptionId}` &&
      (init?.method || "GET") === "GET"
    ) {
      return Response.json({
        id: providerSubscriptionId,
        status: providerSubscriptionStatus,
        external_reference: checkoutExternalReference,
      }, { status: 200 });
    }
    if (
      url.pathname === `/preapproval/${providerSubscriptionId}` &&
      init?.method === "PUT"
    ) {
      const body = JSON.parse(String(init.body || "{}"));
      providerSubscriptionStatus = body.status === "canceled"
        ? "cancelled"
        : body.status;
      return Response.json({
        id: providerSubscriptionId,
        status: providerSubscriptionStatus,
      }, { status: 200 });
    }
    const invoiceMatch = url.pathname.match(/^\/authorized_payments\/(.+)$/);
    if (invoiceMatch) {
      const paymentId = decodeURIComponent(invoiceMatch[1]);
      providerPayments.add(paymentId);
      return Response.json({
        id: paymentId,
        preapproval_id: providerSubscriptionId,
        external_reference: checkoutExternalReference,
        currency_id: "BRL",
        last_modified: new Date().toISOString(),
        payment: { id: paymentId },
      }, { status: 200 });
    }
    const paymentMatch = url.pathname.match(/^\/v1\/payments\/(.+)$/);
    if (
      paymentMatch && (init?.method || "GET") === "GET" &&
      providerPayments.has(decodeURIComponent(paymentMatch[1]))
    ) {
      return Response.json({
        id: decodeURIComponent(paymentMatch[1]),
        status: "approved",
        transaction_amount: 125,
        currency_id: "BRL",
        date_approved: new Date().toISOString(),
      }, { status: 200 });
    }
    throw new Error("Unexpected provider operation in local recurring test.");
  };

  let ownerA: Awaited<ReturnType<typeof makeUser>> | undefined;
  let ownerB: Awaited<ReturnType<typeof makeUser>> | undefined;
  let checkoutId = "";
  let subscriptionId = "";
  try {
    Deno.env.set("MERCADO_PAGO_ENVIRONMENT", "test");
    Deno.env.set("MERCADO_PAGO_PRODUCTION_PAYMENTS_ENABLED", "false");
    Deno.env.set(
      "MERCADO_PAGO_ACCESS_TOKEN",
      "APP_USR-local-only-recurring-test-token",
    );
    Deno.env.set("MERCADO_PAGO_WEBHOOK_SECRET", webhookSecret);
    Deno.env.set("APP_ORIGIN", "http://127.0.0.1:54321");
    Deno.env.set("APP_URL", "http://127.0.0.1:54321/checkout");

    const { data: plan, error: planError } = await admin.from("plans").select(
      "id,price_minor,currency,billing_period,active",
    ).eq("code", "pro").single();
    assert(!planError && plan?.id, "Local PRO plan fixture is unavailable.");
    priorPlan = {
      price_minor: plan.price_minor,
      currency: plan.currency,
      billing_period: plan.billing_period,
      active: plan.active,
    };
    const priced = await admin.from("plans").update({
      price_minor: 12500,
      currency: "BRL",
      billing_period: "month",
      active: true,
    }).eq("id", plan.id);
    assert(
      !priced.error,
      "Local PRO plan could not be configured for the synthetic recurring checkout.",
    );

    ownerA = await makeUser("a");
    ownerB = await makeUser("b");
    const checkoutRequest = new Request(
      "http://127.0.0.1/functions/v1/billing-checkout",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${ownerA.jwt}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          company_id: ownerA.companyId,
          plan_code: "pro",
          method: "card",
          billing_model: "recurring",
          billing_period: "month",
          card_payment: {
            token: `test_${crypto.randomUUID().replaceAll("-", "")}`,
            payment_method_id: "visa",
            installments: 1,
            payer: { email: "billing-recurring-a@example.invalid", identification: { type: "CPF", number: "12345678909" } },
          },
        }),
      },
    );
    const checkoutResponse = await handleBillingCheckoutRequest(
      checkoutRequest,
      { adminClient: admin, providerFetch },
    );
    const checkoutBody = await checkoutResponse.json();
    assert(
      checkoutResponse.status === 200 && checkoutBody.code === "OK" &&
        checkoutBody.subscription?.status === "pending",
      "Local recurring checkout did not stay pending before provider authorization/payment.",
    );
    assert(
      checkoutBody.subscription.init_point ===
        "https://www.mercadopago.com.br/subscriptions/checkout",
      "Safe Mercado Pago subscription redirect was not retained.",
    );
    checkoutId = String(checkoutBody.checkout.id);
    subscriptionId = String(checkoutBody.subscription.id);
    assert(
      checkoutExternalReference === checkoutId,
      "Provider checkout reference does not match the local checkout identity.",
    );

    const ownSubscriptionBefore = await ownerA.client.from(
      "billing_subscriptions",
    ).select("id,status").eq("id", subscriptionId).single();
    assert(
      !ownSubscriptionBefore.error &&
        ownSubscriptionBefore.data.status === "pending",
      "Owner could not read their own pending subscription.",
    );
    const crossTenantBefore = await ownerB.client.from("billing_subscriptions")
      .select("id").eq("id", subscriptionId);
    assert(
      !crossTenantBefore.error && crossTenantBefore.data.length === 0,
      "Other tenant could read the subscription fixture.",
    );
    const callsBeforeForbiddenControl = calls.length;
    const forbiddenControl = await handleBillingSubscriptionManageRequest(
      new Request("http://127.0.0.1/functions/v1/billing-subscription-manage", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${ownerB.jwt}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          company_id: ownerA.companyId,
          subscription_id: subscriptionId,
          action: "cancel",
        }),
      }),
      { adminClient: admin, providerFetch },
    );
    assert(
      forbiddenControl.status === 403 &&
        (await forbiddenControl.json()).code === "FORBIDDEN",
      "Other tenant could control the subscription.",
    );
    assert(
      calls.length === callsBeforeForbiddenControl,
      "Unauthorized cross-tenant control called the provider.",
    );

    providerSubscriptionStatus = "authorized";
    const preapprovalEventId = `event-preapproval-${crypto.randomUUID()}`;
    createdEvents.push(preapprovalEventId);
    const preapprovalEvent = await signedRequest(
      "subscription_preapproval",
      preapprovalEventId,
      providerSubscriptionId,
      webhookSecret,
    );
    const authorizationResponse = await handleBillingWebhookRequest(
      preapprovalEvent,
      { adminClient: admin, providerFetch },
    );
    const authorizationBody = await authorizationResponse.json();
    assert(
      authorizationResponse.status === 200 &&
        authorizationBody.status === "authorized",
      `Provider authorization was not recorded (http=${authorizationResponse.status}, code=${
        String(authorizationBody.code || "none")
      }).`,
    );
    const stillTrial = await admin.from("company_subscriptions").select(
      "status,plan",
    ).eq("company_id", ownerA.companyId).single();
    assert(
      !stillTrial.error && stillTrial.data.status === "trial" &&
        stillTrial.data.plan === "free",
      "Provider authorization alone activated commercial access.",
    );

    const paymentEventId = `event-payment-${crypto.randomUUID()}`;
    const recurringPaymentId = `payment-${crypto.randomUUID()}`;
    createdEvents.push(paymentEventId);
    const paymentEvent = await signedRequest(
      "subscription_authorized_payment",
      paymentEventId,
      recurringPaymentId,
      webhookSecret,
    );
    const paymentResponse = await handleBillingWebhookRequest(paymentEvent, {
      adminClient: admin,
      providerFetch,
    });
    const paymentBody = await paymentResponse.json();
    assert(
      paymentResponse.status === 200 && paymentBody.access_granted === true,
      "Approved recurring payment did not settle.",
    );
    const activeSubscription = await admin.from("company_subscriptions").select(
      "status,plan",
    ).eq("company_id", ownerA.companyId).single();
    assert(
      !activeSubscription.error &&
        activeSubscription.data.status === "active" &&
        activeSubscription.data.plan === "pro",
      "Approved payment did not activate only the matching tenant subscription.",
    );
    const settledPayment = await admin.from("billing_payments").select(
      "status,amount_minor,currency",
    ).eq("provider_payment_id", recurringPaymentId).single();
    assert(
      !settledPayment.error && settledPayment.data.status === "approved" &&
        settledPayment.data.amount_minor === 12500 &&
        settledPayment.data.currency === "BRL",
      "Recurring settlement did not persist the validated payment snapshot.",
    );
    const duplicateResponse = await handleBillingWebhookRequest(
      await signedRequest(
        "subscription_authorized_payment",
        paymentEventId,
        recurringPaymentId,
        webhookSecret,
      ),
      { adminClient: admin, providerFetch },
    );
    assert(
      duplicateResponse.status === 200 &&
        (await duplicateResponse.json()).duplicate === true,
      "Repeated recurring webhook was not idempotent.",
    );

    const control = async (action: "pause" | "resume" | "cancel") =>
      handleBillingSubscriptionManageRequest(
        new Request(
          "http://127.0.0.1/functions/v1/billing-subscription-manage",
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${ownerA!.jwt}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              company_id: ownerA!.companyId,
              subscription_id: subscriptionId,
              action,
            }),
          },
        ),
        { adminClient: admin, providerFetch },
      );
    for (
      const [action, expected] of [["pause", "paused"], [
        "resume",
        "authorized",
      ], ["cancel", "cancelled"]] as const
    ) {
      const response = await control(action);
      const body = await response.json();
      assert(
        response.status === 200 && body.code === "OK" &&
          body.status === expected,
        `Local ${action} did not settle with the provider and database.`,
      );
    }
    const callsAfterCancel = calls.length;
    const duplicateCancel = await control("cancel");
    const duplicateCancelBody = await duplicateCancel.json();
    assert(
      duplicateCancel.status === 200 &&
        duplicateCancelBody.duplicate === true &&
        calls.length === callsAfterCancel,
      "Repeated cancellation contacted provider or repeated side effects.",
    );
    const finalState = await admin.from("billing_subscriptions").select(
      "status,control_lease_token,control_lease_expires_at",
    ).eq("id", subscriptionId).single();
    assert(
      !finalState.error && finalState.data.status === "cancelled" &&
        !finalState.data.control_lease_token &&
        !finalState.data.control_lease_expires_at,
      "Cancellation left an active lease or incorrect terminal state.",
    );
    const cancelledAccess = await admin.from("company_subscriptions").select(
      "status,plan,current_period_end",
    ).eq("company_id", ownerA.companyId).single();
    assert(
      !cancelledAccess.error && cancelledAccess.data.status === "active" &&
        cancelledAccess.data.plan === "pro" && new Date(cancelledAccess.data.current_period_end).getTime() > Date.now(),
      "Cancellation did not stop renewal while preserving the already paid period.",
    );
  } finally {
    if (createdEvents.length) {
      const ids = createdEvents.map((id) => `'${id.replaceAll("'", "''")}'`)
        .join(",");
      await localSql(
        `delete from public.billing_webhook_events where provider_event_id in (${ids})`,
      ).catch(() => "");
    }
    if (createdCompanies.length) {
      await localSql(
        `delete from public.companies where id in (${
          createdCompanies.map((id) => `'${id}'`).join(",")
        })`,
      ).catch(() => "");
    }
    for (const userId of createdUsers) {
      await admin.auth.admin.deleteUser(userId);
    }
    if (priorPlan) {
      const price = priorPlan.price_minor === null
        ? "null"
        : String(priorPlan.price_minor);
      await localSql(
        `update public.plans set price_minor=${price},currency='${priorPlan.currency}',billing_period='${priorPlan.billing_period}',active=${priorPlan.active} where code='pro'`,
      ).catch(() => "");
    }
    for (const [key, value] of previousEnv) Deno.env.set(key, value || "");
  }
});
