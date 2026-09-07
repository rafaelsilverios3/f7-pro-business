import { getSupabaseClient } from '@/data/providers/supabaseProvider';

export const COMPANY_LOGO_BUCKET = 'company-logos';
export const MAX_COMPANY_LOGO_BYTES = 2 * 1024 * 1024;
export const COMPANY_LOGO_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

const localKey = (companyId) => `f7_company_logo_${companyId}`;

export const getCachedCompanyLogo = (companyId) => companyId ? localStorage.getItem(localKey(companyId)) || '' : '';

export function validateCompanyLogo(file) {
  if (!file) throw new Error('Selecione uma imagem para o logo.');
  if (!COMPANY_LOGO_TYPES.includes(file.type)) throw new Error('Use um arquivo PNG, JPG, JPEG ou WEBP.');
  if (file.size > MAX_COMPANY_LOGO_BYTES) throw new Error('O logo deve ter no máximo 2 MB.');
}

export async function uploadCompanyLogo({ companyId, role, file }) {
  if (role !== 'admin') throw new Error('Somente administradores podem alterar o logo da empresa.');
  if (!companyId) throw new Error('Nenhuma empresa ativa foi encontrada.');
  validateCompanyLogo(file);
  const client = getSupabaseClient();
  const path = `${companyId}/${crypto.randomUUID()}`;
  const { error } = await client.storage.from(COMPANY_LOGO_BUCKET).upload(path, file, { upsert: false, contentType: file.type, cacheControl: '3600' });
  if (error) throw new Error('O armazenamento de logos ainda não está configurado.');
  const { data } = client.storage.from(COMPANY_LOGO_BUCKET).getPublicUrl(path);
  const url = data?.publicUrl || '';
  if (url) localStorage.setItem(localKey(companyId), JSON.stringify({ url, path }));
  return url;
}

export async function removeCompanyLogo({ companyId, role }) {
  if (role !== 'admin') throw new Error('Somente administradores podem alterar o logo da empresa.');
  if (!companyId) return;
  const cached = localStorage.getItem(localKey(companyId));
  let path = '';
  try { path = JSON.parse(cached || '{}').path || ''; } catch { path = ''; }
  if (path) await getSupabaseClient().storage.from(COMPANY_LOGO_BUCKET).remove([path]);
  localStorage.removeItem(localKey(companyId));
}

