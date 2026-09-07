import { getDataProvider } from '@/data/providerSelector';
import { getSupabaseClient } from '@/data/providers/supabaseProvider';

const SAFE_INTEGRATION_FIELDS = ['id', 'company_id', 'provider', 'status', 'external_account_id', 'external_phone_id', 'external_business_id', 'created_at', 'updated_at'];

export const sanitizeIntegration = (row = {}) => Object.fromEntries(SAFE_INTEGRATION_FIELDS.filter((key) => row[key] !== undefined).map((key) => [key, row[key]]));

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

export async function checkIntegrationHealth() {
  if (import.meta.env.VITE_DATA_PROVIDER !== 'supabase') return null;
  const { data, error } = await getSupabaseClient().functions.invoke('integration-health', { body: {} });
  if (error) throw error;
  return data;
}

