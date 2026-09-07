import { getDataProvider } from '@/data/providerSelector';
import { getSupabaseClient } from '@/data/providers/supabaseProvider';

const SAFE_INTEGRATION_FIELDS = ['id', 'company_id', 'provider', 'status', 'external_account_id', 'external_phone_id', 'external_business_id', 'created_at', 'updated_at'];

export const sanitizeIntegration = (row = {}) => Object.fromEntries(SAFE_INTEGRATION_FIELDS.filter((key) => row[key] !== undefined).map((key) => [key, row[key]]));

function redactDiagnosticText(value) {
  return String(value || '')
    .replace(/Bearer\s+[^\s"']+/gi, 'Bearer [REDACTED]')
    .replace(/(access[_-]?token|app[_-]?secret|verify[_-]?token|authorization)\s*[:=]\s*[^,\s}\]]+/gi, '$1=[REDACTED]')
    .slice(0, 280);
}

export function safeMetaDiagnostic(error = {}) {
  const meta = error.meta && typeof error.meta === 'object' ? error.meta : null;
  if (!meta) return null;
  return {
    httpStatus: error.httpStatus ?? null,
    code: meta.code ?? error.metaCode ?? null,
    subcode: meta.subcode ?? error.metaSubcode ?? null,
    type: typeof meta.type === 'string' ? redactDiagnosticText(meta.type) : null,
    message: typeof meta.message === 'string' ? redactDiagnosticText(meta.message) : null,
    graphVersion: error.graphVersion || null,
  };
}

export async function listIntegrations(companyId) {
  if (!companyId) return [];
  if (import.meta.env.VITE_DATA_PROVIDER !== 'supabase') {
    try { return (await getDataProvider().entity('CompanyIntegration').filter({ company_id: companyId }, '-updated_date', 50)).map(sanitizeIntegration); } catch { return []; }
  }
  const { data, error } = await getSupabaseClient().from('company_integrations').select('id,company_id,provider,status,external_account_id,external_phone_id,external_business_id,created_at,updated_at').eq('company_id', companyId).order('updated_at', { ascending: false });
  if (error) return [];
  return (data || []).map(sanitizeIntegration);
}

export async function listIntegrationLogs(companyId) {
  if (!companyId) return [];
  if (import.meta.env.VITE_DATA_PROVIDER !== 'supabase') {
    try { return await getDataProvider().entity('IntegrationLog').filter({ company_id: companyId }, '-created_date', 20); } catch { return []; }
  }
  const { data, error } = await getSupabaseClient().from('integration_logs').select('id,provider,event,status,external_id,created_at').eq('company_id', companyId).order('created_at', { ascending: false }).limit(20);
  if (error) return [];
  return data || [];
}

export async function checkIntegrationHealth(companyId) {
  if (import.meta.env.VITE_DATA_PROVIDER !== 'supabase') return null;
  const { data, error } = await getSupabaseClient().functions.invoke('integration-health', { body: companyId ? { company_id: companyId } : {} });
  if (error) throw error;
  return data;
}

async function invokeIntegration(functionName, body) {
  const { data, error } = await getSupabaseClient().functions.invoke(functionName, { body });
  if (error) {
    let detail = null;
    try {
      const context = error.context?.clone ? error.context.clone() : error.context;
      detail = await context?.json?.();
    } catch { /* provider errors stay generic */ }
    const meta = detail?.meta && typeof detail.meta === 'object' ? detail.meta : null;
    const metaCode = meta?.code ?? detail?.meta_code;
    const metaSubcode = meta?.subcode ?? detail?.meta_subcode;
    const cause = new Error(metaCode != null
      ? `Meta recusou a validação do número. Código: ${metaCode}${metaSubcode != null ? `/${metaSubcode}` : ''}. Verifique token, permissões e vínculo com a conta WhatsApp Business.`
      : detail?.message || error.message || 'Não foi possível concluir a ação.');
    Object.assign(cause, {
      code: detail?.code || null,
      providerStatus: detail?.provider_status || null,
      meta,
      metaCode: metaCode ?? null,
      metaSubcode: metaSubcode ?? null,
      graphVersion: detail?.graph_version || null,
      httpStatus: detail?.http_status || error.context?.status || null,
    });
    throw cause;
  }
  if (data?.code && data.code !== 'OK') throw new Error(data.code);
  return data;
}

export const connectWhatsApp = (companyId, phoneNumberId) => invokeIntegration('whatsapp-connect', { company_id: companyId, phone_number_id: phoneNumberId });
export const disconnectWhatsApp = (companyId) => invokeIntegration('whatsapp-disconnect', { company_id: companyId });
export const testWhatsAppConnection = (companyId) => invokeIntegration('whatsapp-test', { company_id: companyId });
