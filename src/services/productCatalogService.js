import { getSupabaseClient } from '@/data/providers/supabaseProvider';

export const PRODUCT_IMAGE_BUCKET = 'product-catalog';
export const PRODUCT_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
export const PRODUCT_IMAGE_MAX_BYTES = 5 * 1024 * 1024;

function assertManage(canManage) { if (!canManage) throw new Error('Você não tem permissão para gerenciar o catálogo.'); }
function validateImage(file) { if (!file || !PRODUCT_IMAGE_TYPES.includes(file.type)) throw new Error('Use uma imagem PNG, JPG ou WEBP.'); if (file.size > PRODUCT_IMAGE_MAX_BYTES) throw new Error('A imagem deve ter no máximo 5 MB.'); }

export async function listProductImages(companyId, productId) {
  const { data, error } = await getSupabaseClient().from('product_images').select('*').eq('company_id', companyId).eq('product_id', productId).order('sort_order', { ascending: true });
  if (error) throw error;
  return Promise.all((data || []).map(async (image) => { const { data: signed } = await getSupabaseClient().storage.from(PRODUCT_IMAGE_BUCKET).createSignedUrl(image.storage_path, 3600); return { ...image, url: signed?.signedUrl || '' }; }));
}

export async function uploadProductImages({ companyId, productId, files, canManage }) {
  assertManage(canManage); if (!companyId || !productId) throw new Error('Salve o produto antes de adicionar imagens.');
  const client = getSupabaseClient(); const uploaded = [];
  for (const file of Array.from(files || [])) { validateImage(file); const ext = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg'; const path = `${companyId}/${productId}/${crypto.randomUUID()}.${ext}`; const result = await client.storage.from(PRODUCT_IMAGE_BUCKET).upload(path, file, { contentType: file.type, cacheControl: '3600' }); if (result.error) throw result.error; const { data, error } = await client.from('product_images').insert({ company_id: companyId, product_id: productId, storage_path: path, is_primary: false }).select().single(); if (error) { await client.storage.from(PRODUCT_IMAGE_BUCKET).remove([path]); throw error; } uploaded.push(data); }
  return uploaded;
}

export async function removeProductImage({ companyId, image, canManage }) {
  assertManage(canManage); const client = getSupabaseClient(); const { error } = await client.from('product_images').delete().eq('id', image.id).eq('company_id', companyId); if (error) throw error; if (image.storage_path) await client.storage.from(PRODUCT_IMAGE_BUCKET).remove([image.storage_path]);
}

export async function listProductVariants(companyId, productId) {
  const { data, error } = await getSupabaseClient().from('product_variants').select('*').eq('company_id', companyId).eq('product_id', productId).order('created_at', { ascending: true }); if (error) throw error; return data || [];
}
export async function createProductVariant({ companyId, productId, data, canManage }) { assertManage(canManage); const { data: result, error } = await getSupabaseClient().from('product_variants').insert({ ...data, company_id: companyId, product_id: productId }).select().single(); if (error) throw error; return result; }
export async function updateProductVariant({ companyId, id, data, canManage }) { assertManage(canManage); const { data: result, error } = await getSupabaseClient().from('product_variants').update(data).eq('id', id).eq('company_id', companyId).select().single(); if (error) throw error; return result; }
export async function removeProductVariant({ companyId, id, canManage }) { assertManage(canManage); const { error } = await getSupabaseClient().from('product_variants').delete().eq('id', id).eq('company_id', companyId); if (error) throw error; }
