import { admin, auth, corsHeaders, json } from '../_shared/core.ts';
import { classifyIntelligenceMode, type IntelligenceMode } from '../_shared/intelligenceIntent.ts';
import { conductWebResearch } from '../_shared/webResearch.ts';

const MAX_QUERY_LENGTH = 600;
const MAX_ROWS = 1000;
const ALLOWED_ROLES = new Set(['admin', 'gestor']);

function cleanText(value: unknown, max = MAX_QUERY_LENGTH) {
  return String(value || '').replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

function uuid(value: unknown) {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value) ? value : null;
}

function summarizeInternal(query: string, products: any[], customers: any[], sales: any[]) {
  const text = query.toLocaleLowerCase('pt-BR');
  const lowStock = products.filter((item) => Number(item.stock || 0) <= Number(item.minimum_stock || 0));
  const customerRows = customers.filter((item) => Number(item.sale_count || 0) > 0).sort((a, b) => Number(b.total_purchased || 0) - Number(a.total_purchased || 0));
  const productSales = new Map<string, { name: string; quantity: number; revenue: number }>();
  for (const sale of sales) {
    if (sale.status === 'cancelled') continue;
    for (const item of Array.isArray(sale.items) ? sale.items : []) {
      const key = String(item.product_id || item.name || '').trim();
      if (!key) continue;
      const current = productSales.get(key) || { name: cleanText(item.name || key, 160), quantity: 0, revenue: 0 };
      current.quantity += Number(item.quantity || 0);
      current.revenue += Number(item.total || item.price || 0) * (item.quantity && !item.total ? Number(item.quantity) : 1);
      productSales.set(key, current);
    }
  }
  const bestSellers = [...productSales.values()].sort((a, b) => b.quantity - a.quantity).slice(0, 5);
  const wantsCustomers = /cliente|recompra|inativ/i.test(text);
  const wantsSales = /vend|giro|priorizar/i.test(text);
  const wantsStock = /estoque|ruptura|produto parado|baixo giro/i.test(text);
  const parts: string[] = [];
  if (wantsStock) parts.push(lowStock.length ? `Encontrei ${lowStock.length} produto(s) no limite ou abaixo do estoque mínimo: ${lowStock.slice(0, 8).map((item) => cleanText(item.name, 100)).join(', ')}.` : 'Não há produtos no limite de estoque mínimo nos dados disponíveis.');
  if (wantsCustomers) parts.push(customerRows.length ? `Há ${customerRows.length} cliente(s) com histórico de compra; os mais recorrentes são ${customerRows.slice(0, 5).map((item) => cleanText(item.name, 80)).join(', ')}.` : 'Não há histórico de clientes suficiente para sugerir recompra.');
  if (wantsSales) parts.push(bestSellers.length ? `Os itens com maior quantidade vendida registrada são ${bestSellers.map((item) => `${item.name} (${item.quantity})`).join(', ')}.` : 'Não há itens de venda suficientes para calcular giro.');
  if (!parts.length) parts.push(`A consulta interna encontrou ${products.length} produto(s), ${customers.length} cliente(s) e ${sales.length} venda(s) no ambiente desta empresa.`);
  return { answer: parts.join(' '), facts: { products: products.length, customers: customers.length, sales: sales.length, low_stock: lowStock.length, best_sellers: bestSellers }, sufficient: products.length + customers.length + sales.length > 0 };
}

async function recordRun(sb: any, companyId: string, traceId: string, patch: Record<string, unknown>) {
  try { await sb.from('ai_runs').upsert({ company_id: companyId, trace_id: traceId, mode: 'assisted', ...patch }, { onConflict: 'company_id,trace_id' }); } catch { /* observability never changes the answer */ }
}

async function recordEvent(sb: any, companyId: string, traceId: string, stage: string, status = 'success', counts: Record<string, unknown> = {}, safeErrorCode?: string) {
  try { await sb.from('ai_run_events').insert({ company_id: companyId, trace_id: traceId, stage, status, counts, safe_error_code: safeErrorCode || null }); } catch { /* observability is best effort */ }
}

function externalSources(research: any) {
  return (research?.results || []).map((item: any) => ({ title: cleanText(item.title, 240), url: item.url, retrieved_at: item.retrieved_at, evidence: cleanText(item.snippet, 1000), source_type: item.source_type }));
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const started = Date.now();
  let sb: any;
  let companyId: string | null = null;
  let traceId = crypto.randomUUID();
  try {
    const jwt = auth(req);
    sb = admin();
    const { data: userData } = await sb.auth.getUser(jwt);
    if (!userData?.user) return json({ code: 'AUTH_REQUIRED' }, 401);
    const body = await req.json().catch(() => ({}));
    companyId = uuid(body?.company_id);
    const query = cleanText(body?.query);
    if (!companyId || !query) return json({ code: 'INVALID_REQUEST' }, 422);
    const { data: member } = await sb.from('company_users').select('role,active').eq('company_id', companyId).eq('user_id', userData.user.id).maybeSingle();
    if (!member?.active || !ALLOWED_ROLES.has(member.role)) return json({ code: 'FORBIDDEN' }, 403);
    const mode: IntelligenceMode = classifyIntelligenceMode(query);
    await recordRun(sb, companyId, traceId, { current_stage: 'REQUEST_RECEIVED', status: 'running', provider: mode === 'internal' ? 'internal' : null, started_at: new Date(started).toISOString() });
    await recordEvent(sb, companyId, traceId, 'INTENT_CLASSIFIED', 'success', { mode });
    const [productsResult, customersResult, salesResult, settingsResult] = await Promise.all([
      mode === 'external' ? Promise.resolve({ data: [], error: null }) : sb.from('products').select('id,name,sku,stock,minimum_stock,price,active').eq('company_id', companyId).limit(MAX_ROWS),
      mode === 'external' ? Promise.resolve({ data: [], error: null }) : sb.from('customers').select('id,name,total_purchased,sale_count,avg_ticket,last_purchase_date').eq('company_id', companyId).limit(MAX_ROWS),
      mode === 'external' ? Promise.resolve({ data: [], error: null }) : sb.from('sales').select('id,status,total,items,sale_date').eq('company_id', companyId).order('sale_date', { ascending: false }).limit(MAX_ROWS),
      sb.from('company_assistant_settings').select('allow_web_research,max_daily_web_queries,max_research_rounds').eq('company_id', companyId).maybeSingle(),
    ]);
    for (const result of [productsResult, customersResult, salesResult]) if (result.error) throw result.error;
    const internal = summarizeInternal(query, productsResult.data || [], customersResult.data || [], salesResult.data || []);
    await recordEvent(sb, companyId, traceId, 'INTERNAL_CONTEXT_READY', 'success', internal.facts);
    let research: any = null;
    let externalUnavailable: string | null = null;
    if (mode !== 'internal') {
      if (settingsResult.error || settingsResult.data?.allow_web_research === false) externalUnavailable = 'EXTERNAL_RESEARCH_NOT_ALLOWED';
      else {
        const budget = await sb.rpc('reserve_ai_budget', { target_company: companyId, requested_ai_calls: 0, requested_web_queries: 1, requested_tokens: 0, requested_cost: 0 });
        if (budget.error || budget.data?.allowed === false) externalUnavailable = 'EXTERNAL_RESEARCH_BUDGET_UNAVAILABLE';
        else {
          await recordEvent(sb, companyId, traceId, 'EXTERNAL_RESEARCH_STARTED', 'success', { mode });
          research = await conductWebResearch({ sb, company_id: companyId, query: { query, application: query, locale: 'pt-BR', country: 'BR', market: 'brazil', region: 'south_america', max_results: 5 }, limits: { max_rounds: settingsResult.data?.max_research_rounds || 2, max_web_queries: settingsResult.data?.max_daily_web_queries || 3 }, onQuery: async (event, details) => recordEvent(sb, companyId!, traceId, event, event === 'WEB_SEARCH_QUERY_FAILED' ? 'error' : 'success', details as any, details.code) });
          if (research?.status === 'FAILED' || research?.failure_codes?.includes('WEB_SEARCH_NOT_CONFIGURED')) externalUnavailable = research?.failure_codes?.[0] || 'EXTERNAL_RESEARCH_UNAVAILABLE';
          await recordEvent(sb, companyId, traceId, 'EXTERNAL_RESEARCH_COMPLETED', externalUnavailable ? 'error' : 'success', { results: research?.results_count || 0, candidates: research?.candidates?.length || 0 }, externalUnavailable || undefined);
        }
      }
    }
    const sources = externalSources(research);
    const candidate = (research?.eligible_candidates || research?.candidates || []).slice(0, 10).map((item: any) => ({ part_number: item.part_number || null, title: item.title || item.part_number || 'Referência externa', confidence: item.confidence ?? null, evidence: item.evidence || [], source_count: item.evidence_count || 0 }));
    const answer = mode === 'internal'
      ? internal.answer
      : externalUnavailable
        ? mode === 'hybrid' ? `${internal.answer} Pesquisa externa ainda não configurada ou indisponível; nenhum resultado externo foi inventado.` : 'Pesquisa externa ainda não configurada ou indisponível. Nenhum resultado externo foi inventado.'
        : `${mode === 'hybrid' ? `${internal.answer} ` : ''}${candidate.length ? `Encontrei ${candidate.length} referência(s) externa(s) com fontes rastreáveis.` : 'A pesquisa externa não encontrou evidência suficiente.'}`;
    const duration = Date.now() - started;
    await recordRun(sb, companyId, traceId, { current_stage: 'COMPLETED', status: 'completed', provider: research?.provider || (mode === 'internal' ? 'internal' : null), query_count: research?.queries_executed || 0, source_domains: sources.map((item) => new URL(item.url).hostname), candidate_count: candidate.length, duration_ms: duration, finished_at: new Date().toISOString() });
    await recordEvent(sb, companyId, traceId, 'RESPONSE_CREATED', 'success', { mode, source_count: sources.length, candidate_count: candidate.length });
    return json({ success: true, trace_id: traceId, mode, answer, internal: mode === 'external' ? null : internal, external: mode === 'internal' ? null : { configured: !externalUnavailable, status: externalUnavailable ? 'unavailable' : research?.status || 'INSUFFICIENT_DATA', sources, candidates: candidate }, actions: { can_save_opportunity: candidate.length > 0, requires_human: true } });
  } catch (error) {
    if (sb && companyId) { await recordRun(sb, companyId, traceId, { current_stage: 'FAILED', status: 'failed', safe_error_code: 'INTELLIGENCE_QUERY_FAILED', duration_ms: Date.now() - started, finished_at: new Date().toISOString() }); await recordEvent(sb, companyId, traceId, 'FAILED', 'error', {}, 'INTELLIGENCE_QUERY_FAILED'); }
    return json({ code: 'INTELLIGENCE_QUERY_FAILED', message: 'Não foi possível concluir a análise da F7 Intelligence.', trace_id: traceId }, 500);
  }
});
