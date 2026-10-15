import { handleBillingCheckoutRequest } from "./index.ts";
import { handleBillingSubscriptionManageRequest } from "../billing-subscription-manage/index.ts";
import { handleBillingWebhookRequest } from "../billing-webhook/index.ts";
import {
  blocksLiveBillingInHomologation,
  blocksRecurringCardInHomologation,
} from "../_shared/billingEnvironment.ts";

const HOMOLOG_URL = "https://vwylnjmapixtzhryiutt.supabase.co";
const companyId = "11111111-1111-4111-8111-111111111111";
const userId = "22222222-2222-4222-8222-222222222222";
const subscriptionId = "33333333-3333-4333-8333-333333333333";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function withEnv(values: Record<string, string>, run: () => Promise<void>) {
  return (async () => {
    const previous = new Map(
      Object.keys(values).map((key) => [key, Deno.env.get(key)]),
    );
    try {
      for (const [key, value] of Object.entries(values)) {
        Deno.env.set(key, value);
      }
      await run();
    } finally {
      for (const [key, value] of previous) {
        value === undefined ? Deno.env.delete(key) : Deno.env.set(key, value);
      }
    }
  })();
}

function queryResult(data: unknown) {
  const query: any = {
    select: () => query,
    eq: () => query,
    maybeSingle: async () => ({ data, error: null }),
  };
  return query;
}

function makeAdminClient(subscriptionStatus = "authorized") {
  let rpcCalls = 0;
  const client = {
    auth: {
      getUser: async () => ({
        data: { user: { id: userId, email: "test@example.invalid" } },
        error: null,
      }),
    },
    from(table: string) {
      if (table === "company_users") {
        return queryResult({ role: "admin", active: true });
      }
      if (table === "plans") {
        return queryResult({
          id: "44444444-4444-4444-8444-444444444444",
          code: "pro",
          name: "Pro",
          price_minor: 12500,
          currency: "BRL",
          billing_period: "month",
        });
      }
      if (table === "billing_subscriptions") {
        return queryResult({
          id: subscriptionId,
          company_id: companyId,
          provider: "mercado_pago",
          provider_subscription_id: "synthetic",
          status: subscriptionStatus,
        });
      }
      throw new Error("Unexpected database query in live-payment guard test.");
    },
    rpc: async () => {
      rpcCalls += 1;
      throw new Error("RPC must not run while live billing is blocked.");
    },
    get rpcCalls() {
      return rpcCalls;
    },
  };
  return client;
}

async function signedWebhook(
  secret: string,
  body: Record<string, unknown>,
  id: string,
) {
  const requestId = `local-${crypto.randomUUID()}`;
  const timestamp = String(Math.floor(Date.now() / 1000));
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const manifest = `id:${id};request-id:${requestId};ts:${timestamp};`;
  const bytes = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(manifest),
  );
  const signature = [...new Uint8Array(bytes)].map((value) =>
    value.toString(16).padStart(2, "0")
  ).join("");
  return new Request(
    `https://local.invalid/functions/v1/billing-webhook?data.id=${id}`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-request-id": requestId,
        "x-signature": `ts=${timestamp},v1=${signature}`,
      },
      body: JSON.stringify(body),
    },
  );
}

Deno.test("Billing homologation: production mode is blocked even with live credentials/flag configured", async () => {
  await withEnv({
    SUPABASE_URL: HOMOLOG_URL,
    MERCADO_PAGO_ENVIRONMENT: "production",
    MERCADO_PAGO_PRODUCTION_PAYMENTS_ENABLED: "true",
    MERCADO_PAGO_ACCESS_TOKEN: "APP_USR-synthetic-only",
    MERCADO_PAGO_WEBHOOK_SECRET: "local-only-secret",
  }, async () => {
    assert(
      blocksLiveBillingInHomologation("production"),
      "homologation project did not block production mode",
    );
    assert(
      !blocksLiveBillingInHomologation("test"),
      "sandbox mode was incorrectly blocked",
    );
    assert(
      blocksRecurringCardInHomologation("card"),
      "homologation did not keep recurring card checkout disabled",
    );
    assert(
      !blocksRecurringCardInHomologation("pix"),
      "homologation incorrectly blocked PIX along with recurring card",
    );
    Deno.env.set("SUPABASE_URL", "https://other-project.supabase.co");
    assert(
      !blocksLiveBillingInHomologation("production"),
      "guard blocked an unrelated project",
    );
    Deno.env.set("SUPABASE_URL", HOMOLOG_URL);

    const client = makeAdminClient();
    let providerCalls = 0;
    const providerFetch: typeof fetch = async () => {
      providerCalls += 1;
      throw new Error("Provider must not be called.");
    };
    const checkout = await handleBillingCheckoutRequest(
      new Request("https://local.invalid/functions/v1/billing-checkout", {
        method: "POST",
        headers: {
          authorization: "Bearer synthetic",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          company_id: companyId,
          plan_code: "pro",
          method: "pix",
        }),
      }),
      { adminClient: client, providerFetch },
    );
    assert(
      checkout.status === 409 &&
        (await checkout.json()).code === "HOMOLOGATION_LIVE_PAYMENTS_DISABLED",
      "live checkout was not rejected",
    );
    assert(
      providerCalls === 0 && client.rpcCalls === 0,
      "live checkout reached provider or wrote an intent",
    );

    const manageClient = makeAdminClient("paused");
    const manage = await handleBillingSubscriptionManageRequest(
      new Request(
        "https://local.invalid/functions/v1/billing-subscription-manage",
        {
          method: "POST",
          headers: {
            authorization: "Bearer synthetic",
            "content-type": "application/json",
          },
          body: JSON.stringify({
            company_id: companyId,
            subscription_id: subscriptionId,
            action: "resume",
          }),
        },
      ),
      { adminClient: manageClient, providerFetch },
    );
    assert(
      manage.status === 409 &&
        (await manage.json()).code === "HOMOLOGATION_LIVE_PAYMENTS_DISABLED",
      "live subscription control was not rejected",
    );
    assert(
      providerCalls === 0 && manageClient.rpcCalls === 0,
      "live subscription control reached provider or claimed a write",
    );

    const invalidWebhook = await handleBillingWebhookRequest(
      new Request("https://local.invalid/functions/v1/billing-webhook", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ live_mode: true }),
      }),
      { adminClient: client, providerFetch },
    );
    assert(
      invalidWebhook.status === 401 &&
        (await invalidWebhook.json()).code === "INVALID_WEBHOOK_SIGNATURE",
      "invalid webhook was not rejected by signature validation",
    );

    const webhookBody = {
      id: crypto.randomUUID(),
      live_mode: true,
      type: "payment",
      data: { id: crypto.randomUUID() },
    };
    const eventId = String(webhookBody.data.id);
    const webhook = await handleBillingWebhookRequest(
      await signedWebhook("local-only-secret", webhookBody, eventId),
      { adminClient: client, providerFetch },
    );
    assert(
      webhook.status === 409 &&
        (await webhook.json()).code === "HOMOLOGATION_LIVE_PAYMENTS_DISABLED",
      "signed live webhook was not rejected",
    );
    assert(
      providerCalls === 0 && client.rpcCalls === 0,
      "webhook reached provider or wrote an event",
    );
  });
});

Deno.test("Billing homologation: recurring card is closed before persistence or provider calls", async () => {
  await withEnv({
    SUPABASE_URL: HOMOLOG_URL,
    MERCADO_PAGO_ENVIRONMENT: "test",
    MERCADO_PAGO_ACCESS_TOKEN: "TEST-synthetic-only",
    MERCADO_PAGO_WEBHOOK_SECRET: "local-only-secret",
  }, async () => {
    const client = makeAdminClient();
    let providerCalls = 0;
    const response = await handleBillingCheckoutRequest(
      new Request("https://local.invalid/functions/v1/billing-checkout", {
        method: "POST",
        headers: {
          authorization: "Bearer synthetic",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          company_id: companyId,
          plan_code: "pro",
          method: "card",
          card_token_id: "synthetic-card-token",
        }),
      }),
      {
        adminClient: client,
        providerFetch: async () => {
          providerCalls += 1;
          throw new Error("Provider must not be called.");
        },
      },
    );
    assert(
      response.status === 409 &&
        (await response.json()).code === "HOMOLOGATION_RECURRING_CARD_DISABLED",
      "recurring card checkout was not blocked in homologation",
    );
    assert(
      providerCalls === 0 && client.rpcCalls === 0,
      "recurring card checkout reached provider or persisted an intent",
    );
  });
});
