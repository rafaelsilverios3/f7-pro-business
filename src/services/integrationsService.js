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

export function safeInternalDiagnostic(error = {}) {
  if (error.code !== 'INTERNAL_PROVIDER_ERROR') return null;
  return { httpStatus: error.httpStatus ?? null, stage: typeof error.stage === 'string' ? error.stage : null, internalCode: typeof error.internalCode === 'string' ? error.internalCode : null };
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
  if (import.meta.env.VITE_DATA_PROVIDER !== 'supabase') {
    return getDataProvider().rpc(functionName, { body });
  }

  const supabase = getSupabaseClient();
  const { data: { session } = {} } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error('AUTH_REQUIRED');

  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  const publicKey = import.meta.env.VITE_SUPABASE_ANON_KEY || import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (!supabaseUrl || !publicKey) throw new Error('Supabase não configurado.');

  const response = await fetch(`${supabaseUrl.replace(/\/$/, '')}/functions/v1/${functionName}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      apikey: publicKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  let detail = null;
  try { detail = await response.json(); } catch { /* non-JSON provider errors remain generic */ }
  if (!response.ok) throw createIntegrationError(detail, response.status);
  if (detail?.code && detail.code !== 'OK') throw createIntegrationError(detail, response.status);
  return detail;
}

function createIntegrationError(rawDetail, httpStatus) {
  const detail = rawDetail && typeof rawDetail === 'object' ? rawDetail : {};
  const safeDetail = detail;
  const rawMeta = safeDetail.meta && typeof safeDetail.meta === 'object' ? safeDetail.meta : {};
  const meta = {
    type: typeof rawMeta.type === 'string' ? redactDiagnosticText(rawMeta.type) : null,
    code: rawMeta.code ?? safeDetail.meta_code ?? null,
    subcode: rawMeta.subcode ?? safeDetail.meta_subcode ?? null,
    message: typeof rawMeta.message === 'string' ? redactDiagnosticText(rawMeta.message) : null,
  };
  const metaCode = meta.code;
  const metaSubcode = meta.subcode;
  const cause = new Error(metaCode != null
    ? `Meta recusou a validação do número. Código: ${metaCode}${metaSubcode != null ? `/${metaSubcode}` : ''}. Verifique token, permissões e vínculo com a conta WhatsApp Business.`
    : safeDetail.code === 'INTERNAL_PROVIDER_ERROR' ? 'Falha interna na integração.'
    : typeof safeDetail.message === 'string' ? redactDiagnosticText(safeDetail.message) : 'Não foi possível concluir a ação.');
  Object.assign(cause, {
    code: detail?.code || null,
    providerStatus: detail?.provider_status || null,
    meta,
    metaCode,
    metaSubcode,
    graphVersion: detail?.graph_version ? redactDiagnosticText(detail.graph_version) : null,
    httpStatus: detail?.http_status || httpStatus || null,
    stage: typeof detail?.stage === 'string' ? detail.stage.slice(0, 80) : null,
    internalCode: typeof detail?.internal_code === 'string' ? detail.internal_code.slice(0, 80) : null,
  });
  return cause;
}

export const connectWhatsApp = (companyId, phoneNumberId) => invokeIntegration('whatsapp-connect', { company_id: companyId, phone_number_id: phoneNumberId });
export const disconnectWhatsApp = (companyId) => invokeIntegration('whatsapp-disconnect', { company_id: companyId });
export const testWhatsAppConnection = (companyId) => invokeIntegration('whatsapp-test', { company_id: companyId });
