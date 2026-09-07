import { getSupabaseClient } from '@/data/providers/supabaseProvider';

const publicFields = (product) => ({ id: product.id, name: product.name, category: product.category, subcategory: product.subcategory, short_description: product.short_description || product.description || '', price: Number(product.price || 0), stock: Number(product.stock || 0), images: product.images || [], variants: product.variants || [] });

export async function getPublicStore(slug) {
  if (!slug) throw new Error('Loja não encontrada.');
  if (import.meta.env.VITE_DATA_PROVIDER === 'supabase') {
    const { data, error } = await getSupabaseClient().rpc('get_public_storefront', { p_slug: slug });
    if (error) throw error;
    if (!data?.company) throw new Error('Loja não encontrada ou desativada.');
    const logoPath = data.company.logo_path;
    const logoUrl = logoPath ? getSupabaseClient().storage.from('company-branding').getPublicUrl(logoPath).data.publicUrl : '';
    return { ...data, company: { ...data.company, logo_url: logoUrl }, products: (data.products || []).map((product) => ({ ...publicFields(product), images: (product.images || []).map((image) => ({ ...image, url: getSupabaseClient().storage.from('product-catalog').getPublicUrl(image.storage_path).data.publicUrl })) })) };
  }
  throw new Error('A loja pública requer o provider Supabase.');
}

export async function createPublicStoreOrder({ slug, customer, items }) {
  if (!slug || !customer?.name || !Array.isArray(items) || !items.length) throw new Error('Informe seus dados e pelo menos um produto.');
  const { data, error } = await getSupabaseClient().rpc('create_public_store_order', { p_slug: slug, p_customer: customer, p_items: items });
  if (error) throw error;
  return data;
}
