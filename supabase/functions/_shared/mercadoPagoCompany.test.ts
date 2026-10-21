import {
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
