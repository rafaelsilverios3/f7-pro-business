import { corsHeaders, json, auth, admin } from '../_shared/core.ts';
import { CompanyInternalSource, selectOfficialSources } from '../_shared/officialSources.ts';

const ALLOWED_ROLES = ['admin', 'gestor', 'comercial', 'vendedor', 'atendimento'];
const MAX_CONTEXT_MESSAGES = 20;

function safeText(value: unknown, max = 600) { return String(value || '').replace(/[\u0000-\u001f]/g, ' ').slice(0, max); }
function internalSuggestion(message: string, settings: Record<string, unknown>, products: any[]) {
  const rules = safeText(settings.specific_rules, 400);
  const hasProducts = products.length > 0;
  return {
    suggestion: hasProducts ? 'Vou confirmar os detalhes e a disponibilidade no catálogo da empresa antes de indicar uma opção.' : 'Vou verificar essa informação com a equipe antes de confirmar disponibilidade, preço ou compatibilidade.',
    requires_human: true,
    confidence: 'low',
    sources: [{ type: CompanyInternalSource.type, source_domain: 'F7 interno', retrieved_at: new Date().toISOString() }],
    products_considered: products.map((product) => ({ id: product.id, name: product.name, stock: product.stock, price: product.price })),
    missing_information: rules ? ['Confirmar as regras específicas da empresa antes de responder.'] : ['Mais informações da solicitação do cliente.'],
  };
}

function segmentGuidance(settings: Record<string, unknown>, sources: any[]) {
  const segment = safeText(settings.segment, 120).toLocaleLowerCase('pt-BR');
  const guidance = segment.includes('roup') ? 'Para roupas, confirme produto, tamanho, cor, modelo e disponibilidade.'
    : segment.includes('eletr') ? 'Para eletrônicos, confirme modelo, especificação, compatibilidade e voltagem.'
      : segment.includes('constru') ? 'Para material de construção, confirme aplicação, dimensão, quantidade, rendimento e ambiente.'
        : segment.includes('servi') ? 'Para serviços, confirme tipo, localização, agenda, necessidade e orçamento.'
          : segment.includes('auto') ? 'Para autopeças, confirme veículo, ano, versão, motor, chassi, posição e lado.'
            : 'Descubra os dados necessários a partir do segmento e das regras específicas da empresa.';
  const manufacturerGuidance = sources.some((source) => source.type === 'manufacturer_official' && source.manufacturer === 'John Deere')
    ? 'Para John Deere, confirme modelo, chassi/PIN, conjunto, aplicação, posição, lado e PN gravado antes de indicar uma peça.' : '';
  return `${guidance} ${manufacturerGuidance} Priorize sempre specific_rules: ${safeText(settings.specific_rules, 600) || 'não configuradas'}`;
}

async function generateWithProvider(input: { settings: Record<string, unknown>; messages: any[]; products: any[]; sources: any[] }) {
  const apiKey = Deno.env.get('AI_API_KEY');
  if (!apiKey) return null;
  const endpoint = Deno.env.get('AI_API_URL') || 'https://api.openai.com/v1/chat/completions';
  const model = Deno.env.get('AI_MODEL') || 'gpt-4o-mini';
  const system = [
    'Você é uma assistente comercial em modo assistido. Gere somente uma sugestão para revisão humana.',
    'Nunca invente produto, PN, aplicação, compatibilidade, preço, estoque, prazo ou substituição.',
    'Use primeiro os dados internos e respeite segment, business_description e specific_rules da empresa.',
    'Quando faltar confirmação técnica, faça uma pergunta curta e marque requires_human=true.',
    'Não finalize pedido, cobrança ou envio de mensagem.',
    segmentGuidance(input.settings, input.sources),
  ].join(' ');
  const context = JSON.stringify({ settings: input.settings, messages: input.messages.slice().reverse().map((item) => ({ sender: item.sender_type, content: safeText(item.content, 600), type: item.message_type, media_type: item.media_type })), products: input.products.map((item) => ({ id: item.id, name: item.name, brand: item.brand, category: item.category, price: item.price, stock: item.stock })), sources: input.sources });
  try {
    const response = await fetch(endpoint, { method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model, temperature: 0.1, messages: [{ role: 'system', content: system }, { role: 'user', content: context }], response_format: { type: 'json_object' } }) });
    const payload = await response.json().catch(() => null);
    if (!response.ok) return null;
    const content = payload?.choices?.[0]?.message?.content;
    const parsed = typeof content === 'string' ? JSON.parse(content) : content;
    if (!parsed?.suggestion || typeof parsed.suggestion !== 'string') return null;
    return { suggestion: safeText(parsed.suggestion, 2000), requires_human: parsed.requires_human !== false, confidence: ['high', 'medium', 'low'].includes(parsed.confidence) ? parsed.confidence : 'low' };
  } catch { return null; }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const jwt = auth(req);
    const sb = admin();
    const { data: { user } } = await sb.auth.getUser(jwt);
    if (!user) return json({ code: 'AUTH_REQUIRED' }, 401);
    const body = await req.json().catch(() => ({}));
    const conversationId = typeof body?.conversation_id === 'string' ? body.conversation_id : '';
    if (!conversationId) return json({ code: 'CONVERSATION_REQUIRED' }, 400);

    const { data: conversation, error: conversationError } = await sb.from('conversations').select('id,company_id,customer_id,channel').eq('id', conversationId).maybeSingle();
    if (conversationError) return json({ code: 'INTERNAL_PROVIDER_ERROR', stage: 'conversation_lookup' }, 500);
    if (!conversation) return json({ code: 'NOT_FOUND' }, 404);
    const { data: member, error: memberError } = await sb.from('company_users').select('role,active').eq('company_id', conversation.company_id).eq('user_id', user.id).maybeSingle();
    if (memberError) return json({ code: 'INTERNAL_PROVIDER_ERROR', stage: 'membership_lookup' }, 500);
    if (!member?.active || !ALLOWED_ROLES.includes(member.role)) return json({ code: 'FORBIDDEN' }, 403);
    const { data: allowed, error: featureError } = await sb.rpc('company_has_feature', { target_company: conversation.company_id, feature: 'ai' });
    if (featureError) return json({ code: 'INTERNAL_PROVIDER_ERROR', stage: 'feature_lookup' }, 500);
    if (!allowed) return json({ code: 'FEATURE_NOT_AVAILABLE' }, 403);
    const limited = await sb.rpc('consume_rate_limit', { target_company: conversation.company_id, target_user: user.id, target_metric: 'assistant-suggest', max_count: 10, window_seconds: 60 });
    if (limited.error) return json({ code: 'INTERNAL_PROVIDER_ERROR', stage: 'rate_limit' }, 500);
    if (limited.data === false) return json({ code: 'RATE_LIMITED' }, 429);
    const { data: settings, error: settingsError } = await sb.from('company_assistant_settings').select('commercial_name,segment,business_description,tone,language,business_hours,payment_methods,delivery_policy,return_policy,important_information,specific_rules,mode').eq('company_id', conversation.company_id).maybeSingle();
    if (settingsError) return json({ code: 'INTERNAL_PROVIDER_ERROR', stage: 'settings_lookup' }, 500);
    if ((settings?.mode || 'manual') !== 'assisted') return json({ code: 'ASSISTED_MODE_REQUIRED' }, 403);
    if (Deno.env.get('AI_ENABLED') !== 'true') return json({ code: 'AI_DISABLED', suggestion: null, requires_human: true, sources: [] }, 403);
    if (!Deno.env.get('AI_API_KEY')) return json({ code: 'AI_PROVIDER_NOT_CONFIGURED', suggestion: null, requires_human: true, sources: [] }, 503);

    const [{ data: messages, error: messagesError }, { data: products, error: productsError }, { data: quickReplies, error: quickRepliesError }, { data: handoffRules, error: handoffRulesError }] = await Promise.all([
      sb.from('messages').select('id,sender_type,content,message_type,media_type,created_at').eq('company_id', conversation.company_id).eq('conversation_id', conversationId).order('created_at', { ascending: false }).limit(MAX_CONTEXT_MESSAGES),
      sb.from('products').select('id,name,brand,category,subcategory,short_description,price,stock,active').eq('company_id', conversation.company_id).eq('active', true).limit(200),
      sb.from('company_quick_replies').select('reply_key,title,body,category,active').eq('company_id', conversation.company_id).eq('active', true).limit(100),
      sb.from('company_handoff_rules').select('trigger_key,label,enabled,priority').eq('company_id', conversation.company_id).eq('enabled', true).order('priority').limit(100),
    ]);
    if (messagesError || productsError || quickRepliesError || handoffRulesError) return json({ code: 'INTERNAL_PROVIDER_ERROR', stage: 'context_lookup' }, 500);
    const latestText = (messages || []).map((item: any) => item.content || '').join(' ');
    const sources = selectOfficialSources({ segment: settings?.segment, text: latestText, productText: (products || []).map((item: any) => `${item.brand || ''} ${item.name}`).join(' ') });
    const external = [];
    for (const source of sources) {
      const result = await source.searchOfficialSource({ query: latestText, segment: settings?.segment });
      external.push({ type: 'manufacturer_official', manufacturer: result.manufacturer, domain: new URL(result.source).hostname, url: result.source, retrieved_at: result.retrieved_at, confidence: result.confidence, code: result.code });
    }
    const sourceMetadata = [{ type: 'internal_catalog', domain: 'F7 interno', retrieved_at: new Date().toISOString() }, ...external];
    // The provider receives only sanitized context and source metadata, never
    // signed media URLs or credentials from the company data.
    const providerSuggestion = await generateWithProvider({ settings: { ...(settings || {}), quick_replies: quickReplies || [], handoff_rules: handoffRules || [] }, messages: messages || [], products: products || [], sources: sourceMetadata });
    if (!providerSuggestion) return json({ code: 'AI_PROVIDER_UNAVAILABLE', ...internalSuggestion(latestText, settings || {}, products || []), sources: sourceMetadata }, 503);
    return json({ ...providerSuggestion, sources: sourceMetadata, products_considered: (products || []).map((product: any) => ({ id: product.id, name: product.name, stock: product.stock, price: product.price })), missing_information: [] });
  } catch { return json({ code: 'INTERNAL_PROVIDER_ERROR' }, 500); }
});
