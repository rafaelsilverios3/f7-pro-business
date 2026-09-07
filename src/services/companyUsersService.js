import { getSupabaseClient } from '@/data/providers/supabaseProvider';
import { getDataProvider } from '@/data/providerSelector';

export const COMPANY_ROLES = ['admin', 'gestor', 'financeiro', 'comercial', 'vendedor', 'estoque', 'atendimento'];

export async function listCompanyMembers(companyId) {
  return getDataProvider().listMembers(companyId);
}

export async function listCompanyInvites(companyId) {
  if (import.meta.env.VITE_DATA_PROVIDER !== 'supabase') return [];
  const { data, error } = await getSupabaseClient().from('company_invites').select('id,company_id,email,role,status,expires_at,created_at,accepted_at').eq('company_id', companyId).order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function createCompanyInvite({ companyId, email, role, expiresInDays = 7 }) {
  if (import.meta.env.VITE_DATA_PROVIDER !== 'supabase') throw new Error('Convites Supabase não estão disponíveis no Base44.');
  const expiresAt = new Date(Date.now() + expiresInDays * 86400000).toISOString();
  const { data, error } = await getSupabaseClient().functions.invoke('invite-user', { body: { company_id: companyId, email, role, expires_at: expiresAt } });
  if (error) throw new Error(data?.error || error.message || 'Não foi possível criar o convite.');
  return data;
}

export async function cancelCompanyInvite(inviteId) {
  return getDataProvider().rpc('cancel_company_invite', { invite_id: inviteId });
}

export async function updateMemberRole({ companyId, userId, role }) {
  return getDataProvider().rpc('update_company_member_role', { target_company: companyId, target_user: userId, new_role: role });
}

export async function setMemberActive({ companyId, userId, active }) {
  return getDataProvider().rpc('set_company_member_active', { target_company: companyId, target_user: userId, is_active: active });
}
