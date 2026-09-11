import { getSupabaseClient } from '@/data/providers/supabaseProvider';

export const QUICK_REPLY_PLACEHOLDERS = Object.freeze([
  'cliente_nome', 'empresa_nome', 'produto_nome', 'preco', 'estoque', 'pedido_numero',
]);

export const ASSISTANT_DEFAULTS = Object.freeze({
  tone: 'professional', language: 'pt-BR', mode: 'manual', autonomy_mode: 'ASSISTED', business_hours: {},
});

export const SEGMENT_PRESETS = Object.freeze({
  clothing: { label: 'Moda e vestuário', description: 'Atendimento para roupas, acessórios e tamanhos.', rules: 'Confirmar tamanho, cor e disponibilidade antes de prometer uma peça.' },
  auto_parts: { label: 'Autopeças', description: 'Atendimento para peças e acessórios automotivos.', rules: 'Confirmar veículo, ano, modelo e aplicação antes de indicar uma peça.' },
  services: { label: 'Serviços', description: 'Atendimento para serviços, agenda e propostas.', rules: 'Confirmar escopo, disponibilidade e prazo antes de enviar uma proposta.' },
});

const SETTINGS_FIELDS = [
  'commercial_name', 'segment', 'business_description', 'tone', 'language', 'business_hours',
  'welcome_message', 'out_of_hours_message', 'closing_message', 'payment_methods',
  'delivery_policy', 'return_policy', 'important_information', 'specific_rules', 'mode', 'autonomy_mode',
];

function client() { return getSupabaseClient(); }

export function validateQuickReplyBody(body = '') {
  const unknown = [...String(body).matchAll(/\{\{\s*([a-z0-9_]+)\s*\}\}/gi)]
    .map((match) => match[1]).filter((name) => !QUICK_REPLY_PLACEHOLDERS.includes(name));
  if (unknown.length) throw new Error(`Placeholder não permitido: ${unknown[0]}`);
  return true;
}

export async function getAssistantSettings(companyId) {
  const { data, error } = await client().from('company_assistant_settings').select('*').eq('company_id', companyId).maybeSingle();
  if (error) throw error;
  return { ...ASSISTANT_DEFAULTS, company_id: companyId, ...(data || {}) };
}

export async function saveAssistantSettings(companyId, values) {
  /** @type {Record<string, any>} */
  const payload = SETTINGS_FIELDS.reduce((acc, field) => { if (values[field] !== undefined) acc[field] = values[field]; return acc; }, { company_id: companyId });
  if (!['OFF', 'ASSISTED', 'SUPERVISED_AUTONOMOUS'].includes(payload.autonomy_mode)) payload.autonomy_mode = 'ASSISTED';
  payload.mode = payload.autonomy_mode === 'OFF' ? 'manual' : 'assisted';
  const { data, error } = await client().from('company_assistant_settings').upsert(payload, { onConflict: 'company_id' }).select('*').single();
  if (error) throw error;
  return data;
}

export async function listQuickReplies(companyId) {
  const { data, error } = await client().from('company_quick_replies').select('*').eq('company_id', companyId).order('created_at');
  if (error) throw error;
  return data || [];
}

export async function saveQuickReply(companyId, values) {
  validateQuickReplyBody(values.body);
  const payload = { company_id: companyId, reply_key: values.reply_key, title: values.title, body: values.body, category: values.category || 'general', active: values.active !== false };
  const { data, error } = await client().from('company_quick_replies').upsert(payload, { onConflict: 'company_id,reply_key' }).select('*').single();
  if (error) throw error;
  return data;
}

export async function deleteQuickReply(id) {
  const { error } = await client().from('company_quick_replies').delete().eq('id', id);
  if (error) throw error;
}

export async function listHandoffRules(companyId) {
  const { data, error } = await client().from('company_handoff_rules').select('*').eq('company_id', companyId).order('priority').order('label');
  if (error) throw error;
  return data || [];
}

export async function saveHandoffRule(companyId, values) {
  const payload = { company_id: companyId, trigger_key: values.trigger_key, label: values.label, priority: Number(values.priority) || 100, enabled: values.enabled !== false };
  const { data, error } = await client().from('company_handoff_rules').upsert(payload, { onConflict: 'company_id,trigger_key' }).select('*').single();
  if (error) throw error;
  return data;
}

export async function deleteHandoffRule(id) {
  const { error } = await client().from('company_handoff_rules').delete().eq('id', id);
  if (error) throw error;
}
