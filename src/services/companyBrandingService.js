import { getSupabaseClient } from '@/data/providers/supabaseProvider';

export const COMPANY_LOGO_BUCKET = 'company-branding';
export const MAX_COMPANY_LOGO_BYTES = 2 * 1024 * 1024;
export const COMPANY_LOGO_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

export async function getCompanyLogoUrl(path) {
  if (!path) return '';
  const { data, error } = await getSupabaseClient().storage.from(COMPANY_LOGO_BUCKET).createSignedUrl(path, 3600);
  if (error) throw error;
  return data?.signedUrl || '';
}

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
  const extension = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg';
  const path = `${companyId}/logo/${crypto.randomUUID()}.${extension}`;
  const { error } = await client.storage.from(COMPANY_LOGO_BUCKET).upload(path, file, { upsert: false, contentType: file.type, cacheControl: '3600' });
  if (error) throw new Error('O armazenamento de logos ainda não está configurado.');
  const url = await getCompanyLogoUrl(path);
  try {
    const { data: company } = await client.from('companies').select('logo_path').eq('id', companyId).maybeSingle();
    const { error: updateError } = await client.from('companies').update({ logo_path: path }).eq('id', companyId);
    if (updateError) throw updateError;
    if (company?.logo_path && company.logo_path !== path) await client.storage.from(COMPANY_LOGO_BUCKET).remove([company.logo_path]);
  } catch (cause) {
    await client.storage.from(COMPANY_LOGO_BUCKET).remove([path]);
    throw new Error(cause.message || 'Não foi possível salvar o logo da empresa.');
  }
  return { url, path };
}

export async function removeCompanyLogo({ companyId, role, logoPath }) {
  if (role !== 'admin') throw new Error('Somente administradores podem alterar o logo da empresa.');
  if (!companyId) return;
  const client = getSupabaseClient();
  const { error } = await client.from('companies').update({ logo_path: null }).eq('id', companyId);
  if (error) throw new Error('Não foi possível remover o logo da empresa.');
  if (logoPath) await client.storage.from(COMPANY_LOGO_BUCKET).remove([logoPath]);
}
