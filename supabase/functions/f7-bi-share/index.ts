import { admin, auth, corsHeaders, json } from '../_shared/core.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TOKEN = /^[A-Za-z0-9_-]{40,64}$/;
const ROLES = new Set(['admin', 'gestor', 'comercial']);
const SECTIONS = new Set(['summary', 'charts', 'alerts', 'recommendations', 'methodology']);

function response(body: unknown, status = 200) { return json(body, status); }
function hash(value: string) { return crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)).then((bytes) => Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('')); }
async function derivePasswordProof(salt: string, password: string) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: new TextEncoder().encode(salt), iterations: 150_000 }, key, 256);
  return Array.from(new Uint8Array(bits), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
function tokenValue(bytes: Uint8Array) { return btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', ''); }
function text(value: unknown, limit = 160) { return String(value ?? '').replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, limit); }
function distinct(values: string[]) { return [...new Set(values)]; }
function sum(value: Record<string, unknown> = {}) { return Object.values(value).reduce<number>((total, current) => total + (Number(current) || 0), 0); }

async function requireManager(sb: any, jwt: string, companyId: string) {
  const { data: authData, error: authError } = await sb.auth.getUser(jwt);
  const user = authData?.user;
  if (authError || !user?.id) return { error: 'AUTH_REQUIRED', status: 401 } as const;
  const { data: member, error } = await sb.from('company_users').select('role,active').eq('company_id', companyId).eq('user_id', user.id).maybeSingle();
  if (error) return { error: 'AUTHORIZATION_CHECK_FAILED', status: 500 } as const;
  if (!member?.active || !ROLES.has(member.role)) return { error: 'FORBIDDEN', status: 403 } as const;
  const { data: allowed, error: featureError } = await sb.rpc('company_has_feature', { target_company: companyId, feature: 'business_intelligence' });
  if (featureError) return { error: 'ENTITLEMENT_CHECK_FAILED', status: 500 } as const;
  if (allowed !== true) return { error: 'FEATURE_NOT_ENTITLED', status: 403 } as const;
  return { user } as const;
}

async function readItems(sb: any, companyId: string, importId: string) {
  const result: any[] = [];
  for (let from = 0; ; from += 500) {
    const { data, error } = await sb.from('bi_items').select('id,unit_name,code,description,abc_class,turn_class,historical_value,historical_months,forecast_months,suggested_quantity,eligible_for_suggestion,review_reasons,original_recommendation').eq('company_id', companyId).eq('import_id', importId).order('unit_name').order('code').range(from, from + 499);
    if (error) throw new Error('BI_ITEMS_READ_FAILED');
    result.push(...(data || []));
    if (!data || data.length < 500) break;
  }
  return result;
}

async function buildSnapshot(sb: any, study: any, importRecord: any, company: any, sections: string[]) {
  const items = await readItems(sb, study.company_id, importRecord.id);
  const decisions: any[] = [];
  for (let from = 0; ; from += 500) {
    const { data, error } = await sb.from('bi_decisions').select('item_id,status,reason,adjusted_quantity,created_at').eq('company_id', study.company_id).eq('import_id', importRecord.id).order('created_at', { ascending: false }).range(from, from + 499);
    if (error) throw new Error('BI_DECISIONS_READ_FAILED');
    decisions.push(...(data || []));
    if (!data || data.length < 500) break;
  }
  const latestDecision = new Map<string, any>();
  for (const decision of decisions) if (!latestDecision.has(decision.item_id)) latestDecision.set(decision.item_id, decision);
  const unitNames = distinct(items.map((item) => item.unit_name)).sort();
  const summary = unitNames.map((unit) => {
    const rows = items.filter((item) => item.unit_name === unit);
    const abc = { A: 0, B: 0, C: 0 };
    for (const row of rows) if (row.abc_class in abc) abc[row.abc_class as keyof typeof abc] += 1;
    const turn = { high: 0, medium: 0, low: 0, unclassified: 0 };
    for (const row of rows) {
      const label = text(row.turn_class, 50).toLocaleLowerCase();
      if (label.includes('alto')) turn.high += 1;
      else if (label.includes('medio')) turn.medium += 1;
      else if (label.includes('baixo') || label.includes('nulo')) turn.low += 1;
      else turn.unclassified += 1;
    }
    return { unit, distinctCodes: new Set(rows.map((row) => row.code)).size, abc, turn,
      recommended: rows.filter((row) => row.eligible_for_suggestion).length,
      review: rows.filter((row) => (row.review_reasons || []).length > 0).length,
      historicalValue: rows.reduce((total, row) => total + Number(row.historical_value || 0), 0),
      forecastUnits: rows.reduce((total, row) => total + sum(row.forecast_months || {}), 0),
    };
  });
  const forecastMonths = distinct(items.flatMap((row) => Object.keys(row.forecast_months || {}))).sort();
  const forecast = forecastMonths.map((month) => ({ month, units: unitNames.map((unit) => ({ unit, distinctCodes: new Set(items.filter((row) => row.unit_name === unit && Number(row.forecast_months?.[month] || 0) > 0).map((row) => row.code)).size, quantity: items.filter((row) => row.unit_name === unit).reduce((total, row) => total + Number(row.forecast_months?.[month] || 0), 0) })) }));
  const allHistoryMonths = distinct(items.flatMap((row) => Object.keys(row.historical_months || {}))).sort();
  const history = allHistoryMonths.map((month) => ({ month, units: unitNames.map((unit) => ({ unit, distinctCodes: new Set(items.filter((row) => row.unit_name === unit && Number(row.historical_months?.[month] || 0) > 0).map((row) => row.code)).size, quantity: items.filter((row) => row.unit_name === unit).reduce((total, row) => total + Number(row.historical_months?.[month] || 0), 0) })) }));
  const snapshot: Record<string, unknown> = {
    title: text(study.name),
    client: text(study.client_name, 160) || null,
    company: text(company.name, 160),
    units: unitNames,
    version: importRecord.version,
    data_cutoff: importRecord.data_cutoff,
    published_at: new Date().toISOString(),
    sections,
  };
  if (sections.includes('summary')) snapshot.summary = summary;
  if (sections.includes('charts')) snapshot.charts = { history, forecast };
  if (sections.includes('alerts')) {
    const alerts = items.filter((item) => (item.review_reasons || []).length > 0);
    snapshot.alerts = { total: alerts.length, truncated: alerts.length > 500, items: alerts.slice(0, 500).map((item) => ({ unit: item.unit_name, code: item.code, description: text(item.description, 220), reasons: (item.review_reasons || []).slice(0, 5).map((reason: string) => text(reason, 220)) })) };
  }
  if (sections.includes('recommendations')) {
    const recommendations = items.filter((item) => item.eligible_for_suggestion || latestDecision.has(item.id));
    snapshot.recommendations = { total: recommendations.length, truncated: recommendations.length > 500, items: recommendations.slice(0, 500).map((item) => {
      const decision = latestDecision.get(item.id);
      return { unit: item.unit_name, code: item.code, description: text(item.description, 220), abc: item.abc_class, turn: text(item.turn_class, 60), suggested_quantity: item.suggested_quantity, forecast_months: item.forecast_months, decision: decision?.status || (item.eligible_for_suggestion ? 'recommended' : null) };
    }) };
  }
  if (sections.includes('methodology')) snapshot.methodology = { text: 'Indicadores calculados deterministicamente a partir da versão publicada da importação.', source_model: text(importRecord.source_metadata?.model, 80), details: Array.isArray(importRecord.methodology?.notes) ? importRecord.methodology.notes.slice(0, 12).map((note: string) => text(note, 300)) : [] };
  return snapshot;
}

export async function handleF7BIShare(req: Request) {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return response({ code: 'METHOD_NOT_ALLOWED' }, 405);
  let body: any;
  try { body = await req.json(); } catch { return response({ code: 'INVALID_PAYLOAD' }, 400); }
  const sb = admin();

  if (body?.action === 'view') {
    const token = String(body.token || '');
    if (!TOKEN.test(token)) return response({ code: 'SHARE_UNAVAILABLE' }, 404);
    try {
      const tokenHash = await hash(token);
      const { data: share, error: lookupError } = await sb.from('bi_shared_reports').select('password_salt').eq('token_hash', tokenHash).maybeSingle();
      if (lookupError || !share) return response({ code: 'SHARE_UNAVAILABLE' }, 404);
      let passwordProof: string | null = null;
      if (share.password_salt) {
        if (typeof body.password !== 'string' || body.password.length < 12 || body.password.length > 200) return response({ code: 'SHARE_PASSWORD_REQUIRED' });
        passwordProof = await derivePasswordProof(share.password_salt, body.password);
      }
      const { data, error } = await sb.rpc('bi_get_shared_report', { p_token_hash: tokenHash, p_password: passwordProof });
      if (error) throw new Error('SHARE_LOOKUP_FAILED');
      if (data?.status === 'ok') return response({ code: 'OK', snapshot: data.snapshot });
      if (data?.status === 'password_required') return response({ code: 'SHARE_PASSWORD_REQUIRED' });
      if (data?.status === 'invalid_password') return response({ code: 'SHARE_PASSWORD_INVALID' });
      if (data?.status === 'locked') return response({ code: 'SHARE_LOCKED' });
      return response({ code: 'SHARE_UNAVAILABLE' }, 404);
    } catch { return response({ code: 'SHARE_UNAVAILABLE' }, 404); }
  }

  let jwt: string;
  try { jwt = auth(req); } catch { return response({ code: 'AUTH_REQUIRED' }, 401); }

  if (body?.action === 'create') {
    if (!UUID.test(body.study_id || '') || !UUID.test(body.import_id || '')) return response({ code: 'INVALID_PAYLOAD' }, 400);
    const { data: study, error: studyError } = await sb.from('bi_studies').select('*').eq('id', body.study_id).maybeSingle();
    if (studyError || !study) return response({ code: 'STUDY_NOT_FOUND' }, 404);
    const access = await requireManager(sb, jwt, study.company_id);
    if ('error' in access) return response({ code: access.error }, access.status);
    const { data: importRecord, error: importError } = await sb.from('bi_imports').select('*').eq('id', body.import_id).eq('study_id', study.id).eq('company_id', study.company_id).eq('status', 'complete').maybeSingle();
    if (importError || !importRecord) return response({ code: 'IMPORT_NOT_FOUND' }, 404);
    const sections = Array.isArray(body.sections) ? distinct(body.sections.map((value: unknown) => String(value)).filter((value: string) => SECTIONS.has(value))) : [];
    if (sections.length === 0) return response({ code: 'SHARE_SECTION_REQUIRED' }, 422);
    const validDays = Number(body.expires_in_days);
    if (![7, 30, 90].includes(validDays)) return response({ code: 'SHARE_EXPIRY_INVALID' }, 422);
    const passphrase = body.password == null || body.password === '' ? null : String(body.password);
    if (passphrase && (passphrase.length < 12 || passphrase.length > 200)) return response({ code: 'SHARE_PASSWORD_INVALID' }, 422);
    const { data: company, error: companyError } = await sb.from('companies').select('name').eq('id', study.company_id).single();
    if (companyError) return response({ code: 'COMPANY_LOOKUP_FAILED' }, 500);
    try {
      const snapshot = await buildSnapshot(sb, study, importRecord, company, sections);
      const token = tokenValue(crypto.getRandomValues(new Uint8Array(32)));
      const salt = passphrase ? tokenValue(crypto.getRandomValues(new Uint8Array(16))) : null;
      const passwordHash = passphrase ? await derivePasswordProof(salt!, passphrase) : null;
      const { data: share, error } = await sb.from('bi_shared_reports').insert({
        company_id: study.company_id, study_id: study.id, import_id: importRecord.id,
        token_hash: await hash(token), snapshot, password_hash: passwordHash, password_salt: salt,
        expires_at: new Date(Date.now() + validDays * 86400000).toISOString(), created_by: access.user.id,
      }).select('id,expires_at,created_at').single();
      if (error) throw new Error('SHARE_CREATE_FAILED');
      await sb.from('bi_audit_events').insert({ company_id: study.company_id, study_id: study.id, import_id: importRecord.id, event_type: 'share.created', actor_id: access.user.id, metadata: { share_id: share.id, sections, expires_at: share.expires_at, password_protected: Boolean(passphrase) } });
      const configuredOrigin = Deno.env.get('APP_ORIGIN') || 'https://f7business.com.br';
      const origin = new URL(configuredOrigin).origin;
      return response({ code: 'OK', share: { id: share.id, expires_at: share.expires_at, created_at: share.created_at, password_protected: Boolean(passphrase) }, url: `${origin}/f7-bi/compartilhado/${token}` });
    } catch { return response({ code: 'SHARE_CREATE_FAILED' }, 500); }
  }

  if (body?.action === 'list' || body?.action === 'revoke') {
    if (!UUID.test(body.study_id || '')) return response({ code: 'INVALID_PAYLOAD' }, 400);
    const { data: study, error: studyError } = await sb.from('bi_studies').select('id,company_id').eq('id', body.study_id).maybeSingle();
    if (studyError || !study) return response({ code: 'STUDY_NOT_FOUND' }, 404);
    const access = await requireManager(sb, jwt, study.company_id);
    if ('error' in access) return response({ code: access.error }, access.status);
    if (body.action === 'list') {
      const { data, error } = await sb.from('bi_shared_reports').select('id,import_id,created_at,expires_at,revoked_at,password_hash').eq('company_id', study.company_id).eq('study_id', study.id).order('created_at', { ascending: false }).limit(50);
      if (error) return response({ code: 'SHARE_LIST_FAILED' }, 500);
      return response({ code: 'OK', shares: (data || []).map((share: any) => ({ id: share.id, import_id: share.import_id, created_at: share.created_at, expires_at: share.expires_at, revoked_at: share.revoked_at, password_protected: Boolean(share.password_hash) })) });
    }
    if (!UUID.test(body.share_id || '')) return response({ code: 'INVALID_PAYLOAD' }, 400);
    const { data: share, error } = await sb.from('bi_shared_reports').update({ revoked_at: new Date().toISOString() }).eq('id', body.share_id).eq('company_id', study.company_id).eq('study_id', study.id).is('revoked_at', null).select('id,import_id,revoked_at').maybeSingle();
    if (error) return response({ code: 'SHARE_REVOKE_FAILED' }, 500);
    if (!share) return response({ code: 'SHARE_NOT_ACTIVE' }, 404);
    await sb.from('bi_audit_events').insert({ company_id: study.company_id, study_id: study.id, import_id: share.import_id, event_type: 'share.revoked', actor_id: access.user.id, metadata: { share_id: share.id } });
    return response({ code: 'OK', share: { id: share.id, revoked_at: share.revoked_at } });
  }
  return response({ code: 'INVALID_ACTION' }, 400);
}

if (import.meta.main) Deno.serve(handleF7BIShare);
