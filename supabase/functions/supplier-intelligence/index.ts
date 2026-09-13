import { admin, auth, corsHeaders, json } from '../_shared/core.ts';
import { conductWebResearch } from '../_shared/webResearch.ts';
import { buildSupplierCandidates, safeSupplierPayload } from '../_shared/supplierResearch.ts';

const ROLES = new Set(['admin', 'gestor', 'comercial']);
const clean = (value: unknown, max = 600) => String(value || '').replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const uuid = (value: unknown) => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value) ? value : null;
const sanitizeContext = (value: any) => { if (!value || typeof value !== 'object' || Array.isArray(value)) return {}; const result: Record<string, unknown> = {}; for (const key of ['opportunity_id', 'product_id', 'customer_id', 'supplier_id', 'entity_id']) { const parsed = uuid(value[key]); if (parsed) result[key] = parsed; } for (const key of ['source_module', 'entity_type', 'intent', 'return_path']) { const parsed = clean(value[key], 80); if (parsed) result[key] = parsed; } if (value.evidence && typeof value.evidence === 'object' && !Array.isArray(value.evidence)) result.evidence = JSON.parse(JSON.stringify(value.evidence).slice(0, 4000)); return result; };

async function event(sb: any, companyId: string, traceId: string, stage: string, status = 'success', counts: Record<string, unknown> = {}, code?: string) {
  try { await sb.from('ai_run_events').insert({ company_id: companyId, trace_id: traceId, stage, status, counts, safe_error_code: code || null }); } catch { /* observability is best effort */ }
}

async function saveCandidate(sb: any, companyId: string, candidate: any) {
  const payload = safeSupplierPayload(candidate);
  if (!payload) return { ok: false, code: 'INVALID_CANDIDATE' };
  const { data: existing } = await sb.from('suppliers').select('id,name,email,phone,document').eq('company_id', companyId).ilike('name', payload.name).limit(1).maybeSingle();
  if (existing) return { ok: true, duplicate: true, supplier: existing, source_url: payload.source_url };
  const inserted = await sb.from('suppliers').insert({ company_id: companyId, name: payload.name, email: payload.email, phone: payload.phone }).select('id,name,email,phone,created_at').single();
  if (inserted.error) return { ok: false, code: 'SUPPLIER_SAVE_FAILED', detail: inserted.error.code || 'DB_INSERT_ERROR' };
  let profileSaved = true;
  try {
    const profile = await sb.from('supplier_intelligence_profiles').upsert({ company_id: companyId, supplier_id: inserted.data.id, supplier_score: payload.metadata.score, trust_score: payload.metadata.score, trust_label: payload.metadata.score >= 70 ? 'baixo risco aparente' : payload.metadata.score >= 40 ? 'risco moderado' : 'dados insuficientes', data_confidence: payload.metadata.score, source_summary: payload.source_summary, metadata: { ...payload.metadata, source_url: payload.source_url } }, { onConflict: 'company_id,supplier_id' });
    profileSaved = !profile.error;
  } catch { profileSaved = false; }
  return { ok: true, duplicate: false, supplier: inserted.data, source_url: payload.source_url, profile_saved: profileSaved };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ code: 'METHOD_NOT_ALLOWED' }, 405);
  const traceId = crypto.randomUUID();
  let companyId: string | null = null;
  try {
    const jwt = auth(req); const sb = admin();
    const { data: userData } = await sb.auth.getUser(jwt);
    if (!userData?.user) return json({ code: 'AUTH_REQUIRED' }, 401);
    const body = await req.json().catch(() => ({}));
    companyId = uuid(body?.company_id);
    if (!companyId) return json({ code: 'INVALID_REQUEST' }, 422);
    const { data: member } = await sb.from('company_users').select('role,active').eq('company_id', companyId).eq('user_id', userData.user.id).maybeSingle();
    if (!member?.active || !ROLES.has(member.role)) return json({ code: 'FORBIDDEN' }, 403);
    const { data: supplierAllowed, error: supplierGateError } = await sb.rpc('company_has_feature', { target_company: companyId, feature: 'supplier_intelligence' });
    if (supplierGateError) return json({ code: 'FEATURE_LOOKUP_FAILED' }, 500);
    if (!supplierAllowed) return json({ code: 'FEATURE_NOT_AVAILABLE', message: 'Supplier Intelligence está disponível a partir do plano PREMIUM.' }, 403);
    if (body?.action === 'save') {
      const saved = await saveCandidate(sb, companyId, body.candidate);
      if (!saved.ok) return json(saved, 422);
      await event(sb, companyId, traceId, 'SUPPLIER_SAVED', 'success', { duplicate: saved.duplicate });
      return json({ code: 'OK', trace_id: traceId, ...saved });
    }
    const query = clean(body?.query);
    const context = sanitizeContext(body?.context);
    if (!query) return json({ code: 'INVALID_REQUEST' }, 422);
    const depth = body?.depth === 'detailed' ? 'detailed' : 'quick';
    const history = Array.isArray(body?.history) ? body.history.slice(-4).map((item: any) => clean(item?.query, 300)).filter(Boolean) : [];
    const contextQuery = [...history, query].join(' ').slice(-900);
    const settings = await sb.from('company_assistant_settings').select('allow_web_research,max_daily_web_queries,max_research_rounds').eq('company_id', companyId).maybeSingle();
    if (settings.error || settings.data?.allow_web_research === false) return json({ code: 'EXTERNAL_RESEARCH_NOT_ALLOWED', trace_id: traceId, candidates: [], sources: [] }, 403);
    const requestedQueries = depth === 'detailed' ? 3 : 1;
    const budget = await sb.rpc('reserve_ai_budget', { target_company: companyId, requested_ai_calls: 0, requested_web_queries: requestedQueries, requested_tokens: 0, requested_cost: 0 });
    if (budget.error || budget.data?.allowed === false) return json({ code: 'EXTERNAL_RESEARCH_BUDGET_UNAVAILABLE', trace_id: traceId, candidates: [], sources: [] }, 429);
    await event(sb, companyId, traceId, 'SUPPLIER_SEARCH_STARTED', 'success', { depth, query_length: query.length, opportunity_id: context.opportunity_id || null, product_id: context.product_id || null });
    await event(sb, companyId, traceId, 'EXTERNAL_RESEARCH_STARTED', 'success', { depth });
    const research = await conductWebResearch({ sb, company_id: companyId, query: { query: `${contextQuery} fornecedores distribuidores atacado`, application: query, locale: 'pt-BR', country: 'BR', market: 'brazil', region: 'south_america', max_results: depth === 'detailed' ? 8 : 5 }, limits: { max_rounds: depth === 'detailed' ? Math.min(2, Number(settings.data?.max_research_rounds || 2)) : 1, max_web_queries: depth === 'detailed' ? 3 : 1, max_total_results: depth === 'detailed' ? 10 : 5, max_page_fetches: depth === 'detailed' ? 3 : 1 }, onQuery: async (kind, details) => event(sb, companyId!, traceId, kind, kind === 'WEB_SEARCH_QUERY_FAILED' ? 'error' : 'success', details as any, details.code) });
    const candidates = buildSupplierCandidates(research?.results || [], query);
    const sources = (research?.results || []).map((item: any) => ({ title: clean(item.title, 240), domain: item.domain, url: item.url, evidence: clean(item.snippet, 1000), source_type: item.source_type, retrieved_at: item.retrieved_at }));
    await event(sb, companyId, traceId, 'EXTERNAL_RESEARCH_COMPLETED', research?.status === 'FAILED' ? 'error' : 'success', { results: sources.length, candidates: candidates.length }, research?.failure_codes?.[0]);
    await event(sb, companyId, traceId, 'SUPPLIER_CANDIDATE_FOUND', 'success', { candidates: candidates.length });
    await event(sb, companyId, traceId, 'SUPPLIER_QUALIFICATION_STARTED', 'success', { candidates: candidates.length });
    await event(sb, companyId, traceId, 'SUPPLIER_QUALIFICATION_COMPLETED', 'success', { qualified: candidates.filter((item: any) => item.state === 'QUALIFICADO').length });
    await event(sb, companyId, traceId, 'SUPPLIER_SEARCH_COMPLETED', 'success', { results: sources.length, candidates: candidates.length });
    return json({ code: 'OK', trace_id: traceId, query, depth, context, status: research?.status || 'INSUFFICIENT_DATA', candidates, sources, research: { provider: research?.provider, cache_hit: research?.cache_hit || false, queries_executed: research?.queries_executed || 0, failure_codes: research?.failure_codes || [] } });
  } catch (error) {
    if (companyId) await event(admin(), companyId, traceId, 'ERROR', 'error', {}, error?.code || 'SUPPLIER_RESEARCH_FAILED');
    return json({ code: error?.message === 'AUTH_REQUIRED' ? 'AUTH_REQUIRED' : 'SUPPLIER_RESEARCH_FAILED', trace_id: traceId }, error?.message === 'AUTH_REQUIRED' ? 401 : 500);
  }
});
