import { admin, auth, corsHeaders, json } from '../_shared/core.ts';
import { blocksLiveBillingInHomologation } from '../_shared/billingEnvironment.ts';
import { verifyMercadoPagoCredentialEnvironment } from '../_shared/mercadoPagoCredentials.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type BillingHealthDependencies = {
  adminClient?: any;
  providerFetch?: typeof fetch;
  getEnv?: (key: string) => string | undefined;
};

function safeHealthResponse(values: {
  environment: 'test' | 'production' | 'not_configured';
  state: 'ready' | 'configuration_required' | 'provider_unavailable' | 'payments_disabled';
  paymentsEnabled: boolean;
}) {
  return {
    provider: 'mercado_pago',
    environment: values.environment,
    state: values.state,
    payments_enabled: values.paymentsEnabled,
    pix_allowed: values.paymentsEnabled,
    // Card currently creates recurring subscriptions and remains disabled in
    // homologation until its sandbox flow has been explicitly validated.
    card_enabled: false,
  };
}

export async function handleBillingHealthRequest(
  req: Request,
  dependencies: BillingHealthDependencies = {},
) {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'GET') return json({ code: 'METHOD_NOT_ALLOWED' }, 405);

  let jwt: string;
  try {
    jwt = auth(req);
  } catch {
    return json({ code: 'AUTH_REQUIRED' }, 401);
  }

  const companyId = new URL(req.url).searchParams.get('company_id') || '';
  if (!UUID.test(companyId)) return json({ code: 'INVALID_REQUEST' }, 422);

  try {
    const sb = dependencies.adminClient || admin();
    const { data: userData, error: userError } = await sb.auth.getUser(jwt);
    if (userError || !userData?.user?.id) return json({ code: 'AUTH_REQUIRED' }, 401);

    // Scope the membership lookup to both the authenticated user and the
    // requested tenant. A platform-wide or user-wide membership check is not
    // sufficient for a company billing diagnostic.
    const { data: member, error: membershipError } = await sb
      .from('company_users')
      .select('role,active')
      .eq('company_id', companyId)
      .eq('user_id', userData.user.id)
      .maybeSingle();
    if (membershipError) {
      console.error(JSON.stringify({ event: 'BILLING_HEALTH_AUTHORIZATION_CHECK_FAILED' }));
      return json({ code: 'AUTHORIZATION_CHECK_FAILED' }, 500);
    }
    if (!member?.active || !['admin', 'gestor'].includes(member.role)) {
      return json({ code: 'FORBIDDEN' }, 403);
    }

    const getEnv = dependencies.getEnv || ((key: string) => Deno.env.get(key));
    const environmentValue = (getEnv('MERCADO_PAGO_ENVIRONMENT') || '').trim().toLowerCase();
    const environmentIsValid = environmentValue === 'test' || environmentValue === 'production';
    const environment = environmentIsValid
      ? environmentValue as 'test' | 'production'
      : 'not_configured';
    const token = getEnv('MERCADO_PAGO_ACCESS_TOKEN') || '';
    const webhookSecretConfigured = Boolean(getEnv('MERCADO_PAGO_WEBHOOK_SECRET'));
    const productionPaymentsEnabled = (getEnv('MERCADO_PAGO_PRODUCTION_PAYMENTS_ENABLED') || '').trim().toLowerCase() === 'true';
    const isHomologation = blocksLiveBillingInHomologation(environmentValue);

    // Never probe a production credential in the homologation project, even
    // though the endpoint itself only performs a read-only provider request.
    if (isHomologation) {
      return json(safeHealthResponse({
        environment: environment === 'not_configured' ? 'not_configured' : environment,
        state: 'payments_disabled',
        paymentsEnabled: false,
      }));
    }

    const productionAllowed = environment !== 'production' || productionPaymentsEnabled;
    if (!environmentIsValid || !token || !webhookSecretConfigured || !productionAllowed) {
      return json(safeHealthResponse({ environment, state: 'configuration_required', paymentsEnabled: false }));
    }

    const credentialCheck = await verifyMercadoPagoCredentialEnvironment(
      token,
      environment as 'test' | 'production',
      dependencies.providerFetch || fetch,
    );
    if (credentialCheck === 'mismatch') {
      return json(safeHealthResponse({ environment, state: 'configuration_required', paymentsEnabled: false }));
    }
    if (credentialCheck === 'unavailable') {
      return json(safeHealthResponse({ environment, state: 'provider_unavailable', paymentsEnabled: false }));
    }

    const paymentsEnabled = environment === 'test' || productionPaymentsEnabled;
    return json(safeHealthResponse({
      environment,
      state: paymentsEnabled ? 'ready' : 'payments_disabled',
      paymentsEnabled,
    }));
  } catch {
    console.error(JSON.stringify({ event: 'BILLING_HEALTH_REQUEST_FAILED' }));
    return json({ code: 'BILLING_HEALTH_FAILED' }, 500);
  }
}

if (import.meta.main) {
  Deno.serve((req) => handleBillingHealthRequest(req));
}
