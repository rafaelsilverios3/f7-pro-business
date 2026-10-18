import { corsHeaders,json,auth,admin,userClient,hashToken } from '../_shared/core.ts';
function configuredAppOrigin() {
  const appUrl = Deno.env.get('APP_URL');
  const appOrigin = Deno.env.get('APP_ORIGIN');
  if (!appUrl || !appOrigin) return null;
  try {
    const url = new URL(appUrl);
    const origin = new URL(appOrigin);
    const isSafeOrigin = (value: URL) => value.protocol === 'https:'
      && !value.username
      && !value.password
      && value.pathname === '/'
      && !value.search
      && !value.hash;
    if (!isSafeOrigin(url) || !isSafeOrigin(origin) || url.origin !== origin.origin) return null;
    return url.origin;
  } catch {
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const jwt = auth(req);
    const sb = admin();
    const { data: { user } } = await sb.auth.getUser(jwt);
    if (!user) return json({ error: 'Sessão inválida' }, 401);
    const body = await req.json();
    const { company_id, email, role, expires_at } = body;
    if (!company_id || !email || !role) return json({ error: 'Dados inválidos' }, 400);

    // Fail closed before writing an invite. Never fall back to the production site.
    const appOrigin = configuredAppOrigin();
    if (!appOrigin) return json({ code: 'APP_ORIGIN_NOT_CONFIGURED' }, 503);

    const token = crypto.randomUUID() + crypto.randomUUID();
    const token_hash = await hashToken(token);
    const limited = await sb.rpc('consume_rate_limit', { target_company: company_id, target_user: user.id, target_metric: 'invite-user', max_count: 20, window_seconds: 3600 });
    if (limited.error || limited.data === false) return json({ code: 'RATE_LIMITED' }, 429);
    const { data, error } = await userClient(jwt).rpc('create_company_invite', { target_company: company_id, invite_email: email, invite_role: role, invite_token_hash: token_hash, invite_expires_at: expires_at || new Date(Date.now() + 7 * 864e5).toISOString() });
    if (error) return json({ error: error.message }, 403);
    return json({ invite_id: data?.id, invite_url: `${appOrigin}/aceitar-convite?token=${encodeURIComponent(token)}`, delivery: 'disabled' });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Erro interno' }, 400);
  }
});

