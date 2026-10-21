import {
  hasOAuthConfig,
  hasPaymentConfig,
  oauthTokenPayload,
  mpRequest,
  parseOAuthTokens,
  pkceChallenge,
  verifyWebhookSignature,
} from "./mercadoPagoCompany.ts";

Deno.test("OAuth payload validation accepts a bounded seller token response and rejects malformed identity", () => {
  const parsed = parseOAuthTokens({
    access_token: "a".repeat(32),
    refresh_token: "r".repeat(32),
    user_id: 123456789,
    expires_in: 21600,
    scope: "read write_payments",
    public_key: "APP_USR-public-key",
  });
  if (
    parsed.seller !== "123456789" || parsed.scopes.length !== 2 ||
    parsed.expires !== 21600
  ) throw new Error("unexpected parsed OAuth response");
  let rejected = false;
  try {
    parseOAuthTokens({
      access_token: "short",
      refresh_token: "r".repeat(32),
      user_id: 12,
      expires_in: 10,
    });
  } catch {
    rejected = true;
  }
  if (!rejected) throw new Error("invalid token response must fail closed");
});

Deno.test("PKCE S256 produces base64url digest without padding", async () => {
  const challenge = await pkceChallenge("a".repeat(43));
  if (!/^[A-Za-z0-9_-]{43}$/.test(challenge)) {
    throw new Error("invalid S256 challenge encoding");
  }
  if (challenge !== await pkceChallenge("a".repeat(43))) {
    throw new Error("PKCE challenge should be deterministic for its verifier");
  }
});

Deno.test("webhook HMAC accepts the signed canonical manifest and rejects altered fields", async () => {
  const input = {
    secret: "local-test-secret-only",
    requestId: "req_fixture_001",
    dataId: "987654321",
    timestamp: "1704908010",
  };
  const manifest =
    `id:${input.dataId};request-id:${input.requestId};ts:${input.timestamp};`;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(input.secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = [
    ...new Uint8Array(
      await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(manifest)),
    ),
  ].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  const base = {
    signature: `ts=${input.timestamp},v1=${signature}`,
    requestId: input.requestId,
    dataId: input.dataId,
    secret: input.secret,
  };
  if (!await verifyWebhookSignature(base)) {
    throw new Error("valid test signature rejected");
  }
  if (await verifyWebhookSignature({ ...base, dataId: "987654320" })) {
    throw new Error("altered data id accepted");
  }
  if (await verifyWebhookSignature({ ...base, requestId: "req_fixture_002" })) {
    throw new Error("altered request id accepted");
  }
});

Deno.test("provider requests stay on the Mercado Pago API and sanitize HTTP failures", async () => {
  const success = await mpRequest(
    "/users/me",
    "fixture-token-not-real",
    {},
    async (input) => {
      if (new URL(String(input)).origin !== "https://api.mercadopago.com") {
        throw new Error("unexpected API host");
      }
      return Response.json({ id: 123456789 });
    },
  );
  if (success.body.id !== 123456789) {
    throw new Error("mock provider response was not parsed");
  }

  let safeFailure = "";
  try {
    await mpRequest(
      "/v1/payments",
      "fixture-token-not-real",
      {},
      async () =>
        Response.json({ message: "private provider details" }, {
          status: 401,
        }),
    );
  } catch (error) {
    safeFailure = error instanceof Error ? error.message : "";
  }
  if (safeFailure !== "MP_SELLER_TOKEN_REJECTED") {
    throw new Error("provider HTTP failure was not sanitized");
  }

  let pathRejected = false;
  try {
    await mpRequest(
      "//evil.example/path",
      "fixture-token-not-real",
      {},
      async () => Response.json({}),
    );
  } catch {
    pathRejected = true;
  }
  if (!pathRejected) throw new Error("foreign provider host accepted");
});


Deno.test("OAuth readiness is separate from payment enablement", () => {
  const names = ["MP_COMPANY_CLIENT_ID", "MP_COMPANY_CLIENT_SECRET", "MP_COMPANY_REDIRECT_URI", "MP_COMPANY_CONNECTION_ENABLED", "MP_COMPANY_WEBHOOK_SECRET", "MP_COMPANY_PAYMENTS_ENABLED", "MP_COMPANY_TEST_PAYMENTS_ENABLED", "MP_COMPANY_PRODUCTION_PAYMENTS_ENABLED", "MP_COMPANY_ENVIRONMENT", "SUPABASE_URL"];
  const previous = new Map(names.map((key) => [key, Deno.env.get(key)]));
  try {
    Deno.env.set("MP_COMPANY_CLIENT_ID", "123456789");
    Deno.env.set("MP_COMPANY_CLIENT_SECRET", "fixture-client-secret-123");
    Deno.env.set("MP_COMPANY_REDIRECT_URI", "https://test-project.supabase.co/functions/v1/mercado-pago-company-callback");
    Deno.env.set("SUPABASE_URL", "https://test-project.supabase.co");
    Deno.env.set("MP_COMPANY_CONNECTION_ENABLED", "true");
    Deno.env.set("MP_COMPANY_ENVIRONMENT", "test");
    for (const key of ["MP_COMPANY_WEBHOOK_SECRET", "MP_COMPANY_PAYMENTS_ENABLED", "MP_COMPANY_TEST_PAYMENTS_ENABLED", "MP_COMPANY_PRODUCTION_PAYMENTS_ENABLED"]) Deno.env.delete(key);
    if (!hasOAuthConfig()) throw new Error("OAuth should be ready without payment credentials");
    if (hasPaymentConfig()) throw new Error("OAuth readiness must not enable payments");
    Deno.env.set("MP_COMPANY_WEBHOOK_SECRET", "fixture-webhook-secret");
    Deno.env.set("MP_COMPANY_PAYMENTS_ENABLED", "true");
    if (hasPaymentConfig()) throw new Error("test payments require their own explicit flag");
    Deno.env.set("MP_COMPANY_TEST_PAYMENTS_ENABLED", "true");
    if (!hasPaymentConfig()) throw new Error("explicit test payment gates should enable sandbox readiness");
    Deno.env.set("MP_COMPANY_ENVIRONMENT", "production");
    if (hasPaymentConfig()) throw new Error("production must remain disabled without its separate gate");
    Deno.env.set("MP_COMPANY_PRODUCTION_PAYMENTS_ENABLED", "true");
    if (!hasPaymentConfig()) throw new Error("explicit production gates should be recognized");
  } finally {
    for (const [key, value] of previous) value === undefined ? Deno.env.delete(key) : Deno.env.set(key, value);
  }
});

Deno.test("OAuth token exchange requests test tokens only for test environment", () => {
  const credentials = { grant_type: "authorization_code" };
  if (oauthTokenPayload(credentials, "test").test_token !== "true") throw new Error("sandbox OAuth must request test token");
  if ("test_token" in oauthTokenPayload(credentials, "production")) throw new Error("production OAuth must not request test token");
});
