import { getSupabaseClient } from '@/data/providers/supabaseProvider';

const available = () => import.meta.env.VITE_DATA_PROVIDER === 'supabase';
async function call(action, payload = {}) {
  if (!available()) throw new Error('PLATFORM_ADMIN_UNAVAILABLE');
  const { data, error } = await getSupabaseClient().functions.invoke('platform-admin', { body: { action, ...payload } });
  if (error) {
    let detail = error;
    try { if (error.context) { const body = await error.context.json(); detail = new Error(body?.error || error.message); } } catch { /* preserve SDK error */ }
    throw detail;
  }
  if (data?.error) throw new Error(data.error);
  return data;
}

export const platformAdminService = {
  access: () => call('access'),
  overview: () => call('overview'),
  companies: (params = {}) => call('companies', params),
  users: () => call('users'),
  subscriptions: () => call('subscriptions'),
  company: (companyId) => call('company', { company_id: companyId }),
  companyUsers: (companyId) => call('company_users', { company_id: companyId }),
  warnings: (params = {}) => call('warnings', params),
  audit: () => call('audit'),
  updateCompanyPlan: (companyId, value, reason) => call('update_company_plan', { company_id: companyId, value, reason }),
  updateCompanyStatus: (companyId, value, reason) => call('update_company_status', { company_id: companyId, value, reason }),
  createWarning: (payload) => call('create_warning', payload),
  resolveWarning: (warningId, resolutionNotes, reason) => call('resolve_warning', { warning_id: warningId, resolution_notes: resolutionNotes, reason }),
  updateCompanyUser: (payload) => call('update_company_user', payload),
  features: (companyId) => call('features', companyId ? { company_id: companyId } : {}),
  updateFeature: (payload) => call('update_feature', payload),
  ai: (companyId) => call('ai', companyId ? { company_id: companyId } : {}),
  updateAI: (payload) => call('update_ai', payload),
  whatsapp: (companyId) => call('whatsapp', companyId ? { company_id: companyId } : {}),
  setWhatsAppEnabled: (companyId, enabled, reason) => call('disable_whatsapp', { company_id: companyId, enabled, reason }),
  finance: (companyId) => call('finance', companyId ? { company_id: companyId } : {}),
  usage: (companyId) => call('usage', { company_id: companyId }),
  data: (entity, companyId) => call('data', { entity, company_id: companyId }),
  health: () => call('health'),
  platformAdmins: () => call('platform_admins'),
  createPlatformAdmin: (payload) => call('create_platform_admin', payload),
  updatePlatformAdmin: (payload) => call('update_platform_admin', payload),
};
