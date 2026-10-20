import { handleBillingCheckoutRequest } from "./index.ts";

const COMPANY = "11111111-1111-4111-8111-111111111111";
const CHECKOUT = "22222222-2222-4222-8222-222222222222";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function withEnv(values: Record<string, string>, run: () => Promise<void>) {
  const previous = new Map(Object.keys(values).map((key) => [key, Deno.env.get(key)]));
  try {
    for (const [key, value] of Object.entries(values)) Deno.env.set(key, value);
    await run();
  } finally {
    for (const [key, value] of previous) {
      value === undefined ? Deno.env.delete(key) : Deno.env.set(key, value);
    }
  }
}

function makeClient(billingModel: string, billingPeriod: string, amountMinor: number) {
  const rpcNames: string[] = [];
  const client: any = {
    auth: { getUser: async () => ({ data: { user: { id: "33333333-3333-4333-8333-333333333333", email: "payer@example.invalid" } } }) },
    from(table: string) {
      const query: any = {
        select: () => query,
        eq: () => query,
        maybeSingle: async () => table === "company_users"
          ? { data: { role: "admin", active: true }, error: null }
          : { data: { id: "44444444-4444-4444-8444-444444444444", code: "pro", name: "Pro", price_minor: 12500, currency: "BRL", billing_period: "month" }, error: null },
      };
      return query;
    },
    async rpc(name: string) {
      rpcNames.push(name);
      if (name === "get_or_create_billing_checkout_v2") return { data: [{
        id: CHECKOUT, company_id: COMPANY, amount_minor: amountMinor, billing_model: billingModel,
        billing_period_snapshot: billingPeriod, expires_at: "2030-01-01T00:00:00.000Z",
      }], error: null };
      if (name === "persist_billing_checkout_payment") return { data: { code: "OK", status: "pending" }, error: null };
      if (name === "persist_billing_subscription") return { data: { code: "OK", subscription_id: "subscription-local", status: "pending" }, error: null };
      throw new Error(`Unexpected RPC: ${name}`);
    },
    rpcNames,
  };
  return client;
}

const verifiedTestIdentity = (url: URL) => url.origin === "https://api.mercadolibre.com" && url.pathname === "/users/me"
  ? Response.json({ id: 123, site_id: "MLB", tags: ["test_user"] })
  : null;

Deno.test("Billing one-time card: uses server total, single-use token and waits for canonical webhook", async () => {
  await withEnv({
    SUPABASE_URL: "https://f7-homologation.invalid",
    MERCADO_PAGO_ENVIRONMENT: "test",
    MERCADO_PAGO_PRODUCTION_PAYMENTS_ENABLED: "false",
    MERCADO_PAGO_ACCESS_TOKEN: "local-test-token",
    MERCADO_PAGO_WEBHOOK_SECRET: "local-only-secret",
  }, async () => {
    const client = makeClient("one_time", "year", 150000);
    const calls: Array<{ endpoint: string; method: string; idempotency: string | null; body: any }> = [];
    const paymentByIdempotency = new Map<string, string>();
    let createdProviderPayments = 0;
    const providerFetch: typeof fetch = async (input, init) => {
      const url = new URL(String(input));
      const method = init?.method || "GET";
      if (verifiedTestIdentity(url)) return verifiedTestIdentity(url)!;
      if (url.origin !== "https://api.mercadopago.com" || url.pathname !== "/v1/payments" || method !== "POST") {
        throw new Error("Unexpected provider request in isolated contract test.");
      }
      const body = JSON.parse(String(init?.body || "{}"));
      const idempotency = new Headers(init?.headers).get("X-Idempotency-Key");
      calls.push({ endpoint: url.pathname, method, idempotency, body });
      if (!idempotency) throw new Error("One-time card request did not include provider idempotency.");
      let id = paymentByIdempotency.get(idempotency);
      if (!id) { id = `test-payment-${++createdProviderPayments}`; paymentByIdempotency.set(idempotency, id); }
      return Response.json({ id, status: "pending", status_detail: "pending_waiting_transfer", transaction_amount: 1500, currency_id: "BRL" }, { status: 201 });
    };
    const request = () => new Request("https://edge.test/billing-checkout", {
      method: "POST",
      headers: { Authorization: "Bearer local-jwt", "Content-Type": "application/json" },
      body: JSON.stringify({ company_id: COMPANY, plan_code: "pro", billing_model: "one_time", billing_period: "year", method: "card", card_payment: {
        token: "single-use-card-token", payment_method_id: "visa", installments: 1,
        payer: { email: "payer@example.invalid", identification: { type: "CPF", number: "12345678909" } },
      } }),
    });
    const response = await handleBillingCheckoutRequest(request(), { adminClient: client, providerFetch });
    const result = await response.json();
    assert(response.status === 200 && result.payment?.status === "pending", "one-time card did not remain pending for webhook confirmation");
    assert(calls.at(0)?.body.transaction_amount === 1500, "annual amount did not come from the server catalog snapshot");
    assert(calls[0].body.external_reference === CHECKOUT && calls[0].body.token === "single-use-card-token", "provider request lost the unique checkout reference or one-use token");
    assert(calls[0].idempotency === `f7-payment-${CHECKOUT}`, "one-time card request lacks a stable checkout idempotency key");
    const retryResponse = await handleBillingCheckoutRequest(request(), { adminClient: client, providerFetch });
    const retry = await retryResponse.json();
    assert(retryResponse.status === 200 && retry.payment?.id === result.payment.id && createdProviderPayments === 1, "repeated checkout created a duplicate provider payment");
    assert(calls.length === 2 && calls.every((call) => call.idempotency === `f7-payment-${CHECKOUT}`), "retry changed the stable idempotency key");
    assert(client.rpcNames.join(",") === "get_or_create_billing_checkout_v2,persist_billing_checkout_payment,get_or_create_billing_checkout_v2,persist_billing_checkout_payment", "payment was not reserved then persisted through the server RPCs on retry");
  });
});

Deno.test("Billing card provider uncertainty stays pending and fails closed", async () => {
  await withEnv({
    SUPABASE_URL: "https://f7-homologation.invalid",
    MERCADO_PAGO_ENVIRONMENT: "test",
    MERCADO_PAGO_PRODUCTION_PAYMENTS_ENABLED: "false",
    MERCADO_PAGO_ACCESS_TOKEN: "local-test-token",
    MERCADO_PAGO_WEBHOOK_SECRET: "local-only-secret",
  }, async () => {
    const client = makeClient("one_time", "month", 12500);
    const providerFetch: typeof fetch = async (input) => {
      const url = new URL(String(input));
      if (verifiedTestIdentity(url)) return verifiedTestIdentity(url)!;
      return new Response("{}", { status: 503 });
    };
    const response = await handleBillingCheckoutRequest(new Request("https://edge.test/billing-checkout", {
      method: "POST",
      headers: { Authorization: "Bearer local-jwt", "Content-Type": "application/json" },
      body: JSON.stringify({ company_id: COMPANY, plan_code: "pro", billing_model: "one_time", billing_period: "month", method: "card", card_payment: {
        token: "single-use-card-token", payment_method_id: "visa", installments: 1,
        payer: { email: "payer@example.invalid", identification: { type: "CPF", number: "12345678909" } },
      } }),
    }), { adminClient: client, providerFetch });
    assert(response.status === 503 && (await response.json()).code === "MERCADO_PAGO_RESULT_UNCERTAIN", "provider uncertainty was reported as a completed payment");
    assert(client.rpcNames.join(",") === "get_or_create_billing_checkout_v2", "uncertain provider result was persisted as paid or approved");
  });
});

Deno.test("Billing recurring annual card: uses a 12-month provider cycle and validated return URL", async () => {
  await withEnv({
    SUPABASE_URL: "https://f7-homologation.invalid",
    MERCADO_PAGO_ENVIRONMENT: "test",
    MERCADO_PAGO_PRODUCTION_PAYMENTS_ENABLED: "false",
    MERCADO_PAGO_ACCESS_TOKEN: "local-test-token",
    MERCADO_PAGO_WEBHOOK_SECRET: "local-only-secret",
    APP_ORIGIN: "https://f7business.example",
    APP_URL: "https://f7business.example/f7probusiness/checkout",
  }, async () => {
    const client = makeClient("recurring", "year", 150000);
    let submitted: any;
    let idempotency: string | null = null;
    const providerFetch: typeof fetch = async (input, init) => {
      const url = new URL(String(input));
      if (verifiedTestIdentity(url)) return verifiedTestIdentity(url)!;
      if (url.origin !== "https://api.mercadopago.com" || url.pathname !== "/preapproval" || init?.method !== "POST") {
        throw new Error("Unexpected provider request in isolated recurring contract test.");
      }
      submitted = JSON.parse(String(init?.body || "{}"));
      idempotency = new Headers(init.headers).get("X-Idempotency-Key");
      return Response.json({ id: "test-subscription-1", status: "pending", init_point: "https://www.mercadopago.com.br/subscriptions/checkout" }, { status: 201 });
    };
    const request = new Request("https://edge.test/billing-checkout", {
      method: "POST",
      headers: { Authorization: "Bearer local-jwt", "Content-Type": "application/json" },
      body: JSON.stringify({ company_id: COMPANY, plan_code: "pro", billing_model: "recurring", billing_period: "year", method: "card", card_payment: {
        token: "single-use-recurring-card-token", payment_method_id: "visa", installments: 1,
        payer: { email: "payer@example.invalid", identification: { type: "CPF", number: "12345678909" } },
      } }),
    });
    const response = await handleBillingCheckoutRequest(request, { adminClient: client, providerFetch });
    const result = await response.json();
    assert(response.status === 200 && result.subscription?.status === "pending", "subscription activated before a confirmed payment");
    assert(submitted.auto_recurring.frequency === 12 && submitted.auto_recurring.frequency_type === "months", "annual cycle used a provider-unsupported year frequency");
    assert(submitted.auto_recurring.transaction_amount === 1500 && submitted.back_url === "https://f7business.example/f7probusiness/checkout", "annual terms or return URL did not match the backend snapshot");
    assert(submitted.external_reference === CHECKOUT && idempotency === `f7-subscription-${CHECKOUT}`, "subscription request lacks stable tenant contract identity/idempotency");
    assert(client.rpcNames.join(",") === "get_or_create_billing_checkout_v2,persist_billing_subscription", "recurring contract was not persisted through the server RPCs");
  });
});
