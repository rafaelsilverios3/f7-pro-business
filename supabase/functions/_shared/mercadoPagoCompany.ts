import { admin, auth, userClient } from "./core.ts";

export const MP_API = "https://api.mercadopago.com";
export const MP_AUTH = "https://auth.mercadopago.com/authorization";
export const MANAGER_ROLES = ["admin", "gestor", "financeiro"];
export const SALES_ROLES = [
  "admin",
  "gestor",
  "financeiro",
  "comercial",
  "vendedor",
];
export const validUuid = (value: unknown): value is string =>
  typeof value === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    .test(value);

function validRedirectUri(): boolean {
  const redirect = Deno.env.get("MP_COMPANY_REDIRECT_URI")?.trim() || "";
  try {
    const callback = new URL(redirect);
    const project = new URL(Deno.env.get("SUPABASE_URL") || "");
    return callback.protocol === "https:" && !callback.username &&
      !callback.password && !callback.search && !callback.hash &&
      callback.origin === project.origin &&
      callback.pathname === "/functions/v1/mercado-pago-company-callback";
  } catch {
    return false;
  }
}

/** OAuth connection is independent and can never enable charges. */
export function hasOAuthConfig(): boolean {
  const id = Deno.env.get("MP_COMPANY_CLIENT_ID")?.trim() || "";
  const secret = Deno.env.get("MP_COMPANY_CLIENT_SECRET")?.trim() || "";
  return Deno.env.get("MP_COMPANY_CONNECTION_ENABLED")?.trim().toLowerCase() ===
      "true" && /^\d{5,30}$/.test(id) && secret.length >= 12 &&
    validRedirectUri();
}

/** Payments remain fail-closed unless each environment gate is explicit. */
export function hasPaymentConfig(): boolean {
  if (
    !hasOAuthConfig() || !Deno.env.get("MP_COMPANY_WEBHOOK_SECRET")?.trim() ||
    Deno.env.get("MP_COMPANY_PAYMENTS_ENABLED")?.trim().toLowerCase() !==
      "true"
  ) return false;
  const environment = Deno.env.get("MP_COMPANY_ENVIRONMENT")?.trim()
    .toLowerCase();
  if (environment === "test") {
    return Deno.env.get("MP_COMPANY_TEST_PAYMENTS_ENABLED")?.trim()
        .toLowerCase() === "true";
  }
  if (environment === "production") {
    return Deno.env.get("MP_COMPANY_PRODUCTION_PAYMENTS_ENABLED")?.trim()
        .toLowerCase() === "true";
  }
  return false;
}

export function oauthTokenPayload(
  credentials: Record<string, string>,
  environment = Deno.env.get("MP_COMPANY_ENVIRONMENT")?.trim().toLowerCase(),
) {
  return environment === "test"
    ? { ...credentials, test_token: "true" }
    : credentials;
}

/** Compatibility alias: legacy connector readiness means OAuth readiness. */
export const hasConnectorConfig = hasOAuthConfig;

export function makeAuthorizationUrl(state: string, challenge: string): string {
  const url = new URL(MP_AUTH);
  url.searchParams.set(
    "client_id",
    Deno.env.get("MP_COMPANY_CLIENT_ID")!.trim(),
  );
  url.searchParams.set("response_type", "code");
  url.searchParams.set("platform_id", "mp");
  url.searchParams.set("state", state);
  url.searchParams.set(
    "redirect_uri",
    Deno.env.get("MP_COMPANY_REDIRECT_URI")!.trim(),
  );
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

export function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(
    /=+$/g,
    "",
  );
}
export async function sha256(value: string): Promise<string> {
  const hash = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(hash)].map((byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
}
export async function pkceChallenge(verifier: string): Promise<string> {
  return base64Url(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)),
    ),
  );
}
export function parseOAuthTokens(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("MP_OAUTH_RESPONSE_INVALID");
  }
  const row = value as Record<string, unknown>;
  const access = typeof row.access_token === "string" ? row.access_token : "";
  const refresh = typeof row.refresh_token === "string"
    ? row.refresh_token
    : "";
  const seller = String(row.user_id || "");
  const expires = Number(row.expires_in);
  if (
    access.length < 16 || access.length > 8192 || refresh.length < 16 ||
    refresh.length > 8192 || !/^\d{3,24}$/.test(seller) ||
    !Number.isFinite(expires) || expires < 60 || expires > 31_536_000
  ) throw new Error("MP_OAUTH_RESPONSE_INVALID");
  const scopes = typeof row.scope === "string"
    ? row.scope.split(/\s+/).filter((scope) => /^[a-z_]{1,50}$/.test(scope))
      .slice(0, 30)
    : [];
  const publicKey =
    typeof row.public_key === "string" && row.public_key.length < 300
      ? row.public_key
      : null;
  return { access, refresh, seller, expires, scopes, publicKey };
}

export async function companyAccess(
  req: Request,
  companyId: string,
  mode: "manage" | "sales",
) {
  let jwt = "";
  try {
    jwt = auth(req);
  } catch {
    return { error: "AUTH_REQUIRED", status: 401 } as const;
  }
  const sb = admin();
  const { data: userData, error: userError } = await sb.auth.getUser(jwt);
  if (userError || !userData.user) {
    return { error: "AUTH_REQUIRED", status: 401 } as const;
  }
  const viewer = userClient(jwt);
  const { data: member, error } = await viewer.from("company_users").select(
    "role,active",
  ).eq("company_id", companyId).eq("user_id", userData.user.id).maybeSingle();
  const role = String(member?.role || "").toLowerCase();
  const allowed = mode === "manage" ? MANAGER_ROLES : SALES_ROLES;
  if (error || member?.active !== true || !allowed.includes(role)) {
    return { error: "FORBIDDEN", status: 403 } as const;
  }
  return { sb, viewer, user: userData.user, role } as const;
}

export async function mpRequest(
  path: string,
  token: string,
  init: RequestInit = {},
  fetcher: typeof fetch = fetch,
) {
  if (!path.startsWith("/") || path.startsWith("//")) {
    throw new Error("MP_PATH_INVALID");
  }
  const url = new URL(path, MP_API);
  if (url.origin !== MP_API) throw new Error("MP_PATH_INVALID");
  let response: Response;
  try {
    response = await fetcher(url, {
      ...init,
      signal: AbortSignal.timeout(15_000),
      headers: {
        Accept: "application/json",
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...init.headers,
        Authorization: `Bearer ${token}`,
      },
    });
  } catch {
    throw new Error("MP_PROVIDER_UNAVAILABLE");
  }
  let body: Record<string, any> = {};
  try {
    const value = await response.json();
    if (value && typeof value === "object" && !Array.isArray(value)) {
      body = value;
    }
  } catch { /* never expose provider response bodies */ }
  if (!response.ok) {
    const code = response.status === 401
      ? "MP_SELLER_TOKEN_REJECTED"
      : response.status === 403
      ? "MP_SELLER_ACCESS_DENIED"
      : response.status === 429
      ? "MP_RATE_LIMITED"
      : response.status >= 500
      ? "MP_PROVIDER_UNAVAILABLE"
      : "MP_PROVIDER_REJECTED";
    throw Object.assign(new Error(code), { status: response.status });
  }
  return { status: response.status, body };
}

export async function verifyWebhookSignature(
  input: {
    signature: string;
    requestId: string;
    dataId: string;
    secret: string;
  },
) {
  const parts = Object.fromEntries(
    input.signature.split(",").map((item) => item.trim().split("=", 2)).filter((
      pair,
    ) => pair.length === 2),
  );
  const timestamp = parts.ts || "";
  const received = parts.v1 || "";
  if (
    !/^\d{10,13}$/.test(timestamp) || !/^[a-f0-9]{64}$/i.test(received) ||
    !input.requestId || !input.dataId
  ) return false;
  const manifest =
    `id:${input.dataId.toLowerCase()};request-id:${input.requestId};ts:${timestamp};`;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(input.secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const expected = [
    ...new Uint8Array(
      await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(manifest)),
    ),
  ].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  const a = new TextEncoder().encode(expected.toLowerCase());
  const b = new TextEncoder().encode(received.toLowerCase());
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let index = 0; index < a.length; index += 1) {
    mismatch |= a[index] ^ b[index];
  }
  return mismatch === 0;
}
