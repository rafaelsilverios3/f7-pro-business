import { getSupabaseClient } from '@/data/providers/supabaseProvider';
import { suppliersRepository } from '@/data/repositories/suppliersRepository';
import { productsRepository } from '@/data/repositories/productsRepository';
import { prepareSupplierOfferInput } from '@/lib/supplierOffers';

function requireSupabaseProvider() {
  if (import.meta.env.VITE_DATA_PROVIDER !== 'supabase') {
    throw new Error('Ofertas de fornecedores exigem o provedor Supabase habilitado neste ambiente.');
  }
}

function throwIfError(error) {
  if (error) throw new Error(error.message || 'Não foi possível concluir a operação da oferta.');
}

function rpcInput(offer) {
  const payload = prepareSupplierOfferInput(offer);
  return Object.fromEntries(Object.entries(payload).map(([key, value]) => [`p_${key}`, value]));
}

export const supplierOffersService = {
  async list(companyId) {
    requireSupabaseProvider();
    if (!companyId) throw new Error('Selecione uma empresa para consultar as ofertas.');
    const [offerResult, suppliers, products] = await Promise.all([
      getSupabaseClient().from('supplier_offers')
        .select('id,company_id,supplier_id,product_id,unit_cost,currency,supplier_quantity,minimum_order_quantity,lead_time_days,source_type,source_url,source_note,observed_at,valid_until,status,verification_note,verified_at,verified_by,approved_at,approved_by,suspended_at,suspended_by,created_at,updated_at')
        .eq('company_id', companyId)
        .order('updated_at', { ascending: false })
        .limit(500),
      suppliersRepository.list(companyId, 'name', 500),
      productsRepository.list(companyId, 'name', 500),
    ]);
    throwIfError(offerResult.error);
    const supplierById = new Map(suppliers.map((supplier) => [supplier.id, supplier]));
    const productById = new Map(products.map((product) => [product.id, product]));
    return (offerResult.data || []).map((offer) => ({
      ...offer,
      supplier_name: supplierById.get(offer.supplier_id)?.name || 'Fornecedor indisponível',
      product_name: productById.get(offer.product_id)?.name || 'Produto indisponível',
      product_sku: productById.get(offer.product_id)?.sku || '',
    }));
  },

  async getFormOptions(companyId) {
    requireSupabaseProvider();
    if (!companyId) throw new Error('Selecione uma empresa para carregar fornecedores e produtos.');
    const [suppliers, products] = await Promise.all([
      suppliersRepository.list(companyId, 'name', 500),
      productsRepository.list(companyId, 'name', 500),
    ]);
    return {
      suppliers: suppliers.filter((supplier) => supplier.name),
      products: products.filter((product) => product.active !== false && product.item_type !== 'service'),
    };
  },

  async create(companyId, offer) {
    requireSupabaseProvider();
    if (!companyId) throw new Error('Selecione uma empresa antes de cadastrar uma oferta.');
    const { data, error } = await getSupabaseClient().rpc('create_supplier_offer', {
      p_company_id: companyId,
      ...rpcInput(offer),
    });
    throwIfError(error);
    return data;
  },

  async update(offerId, offer) {
    requireSupabaseProvider();
    if (!offerId) throw new Error('Oferta inválida.');
    const { data, error } = await getSupabaseClient().rpc('update_supplier_offer', {
      p_offer_id: offerId,
      ...rpcInput(offer),
    });
    throwIfError(error);
    return data;
  },

  async transition(offerId, nextStatus, note = null) {
    requireSupabaseProvider();
    if (!offerId || !nextStatus) throw new Error('Transição de oferta inválida.');
    const { data, error } = await getSupabaseClient().rpc('transition_supplier_offer', {
      p_offer_id: offerId,
      p_next_status: nextStatus,
      p_note: note,
    });
    throwIfError(error);
    return data;
  },
};
