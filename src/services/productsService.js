import { productsRepository } from '@/data/repositories/productsRepository';
import { inventoryRepository } from '@/data/repositories/inventoryRepository';
import { productSchema } from '@/schemas';

const isSupabase = () => import.meta.env.VITE_DATA_PROVIDER === 'supabase';
const numberField = (value, fallback = 0) => {
  if (value === '' || value == null) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};
const isDuplicateSkuError = (error) => String(error?.code || '').toLowerCase() === '23505'
  || Number(error?.status) === 409
  || String(error?.message || '').includes('products_company_id_sku_key');

async function createWithAvailableSku(companyId, payload) {
  const baseSku = typeof payload.sku === 'string' ? payload.sku.trim() : '';
  if (!baseSku) return productsRepository.create(payload, companyId);
  let candidate = baseSku;
  for (let suffix = 0; suffix <= 99; suffix += 1) {
    try {
      return await productsRepository.create({ ...payload, sku: candidate }, companyId);
    } catch (error) {
      if (!isDuplicateSkuError(error) || suffix === 99) throw error;
      candidate = `${baseSku}${suffix + 2}`;
    }
  }
  throw new Error('Não foi possível gerar um SKU disponível.');
}
const productPayload = (companyId, data = {}) => {
  const payload = { company_id: companyId };
  const textFields = ['name', 'item_type', 'duration_minutes', 'sku', 'barcode', 'subcategory', 'brand', 'description', 'short_description', 'full_description', 'material', 'color', 'size', 'model', 'unit', 'dimensions', 'tags', 'keywords', 'featured', 'active'];
  for (const field of textFields) if (Object.prototype.hasOwnProperty.call(data, field)) payload[field] = data[field];
  if (!payload.subcategory && Object.prototype.hasOwnProperty.call(data, 'category')) payload.subcategory = data.category || null;
  const aliases = { cost: 'cost_price', price: 'sale_price', minimum_stock: 'min_stock', commission_rate: 'commission' };
  for (const [field, alias] of Object.entries(aliases)) if (Object.prototype.hasOwnProperty.call(data, field) || Object.prototype.hasOwnProperty.call(data, alias)) payload[field] = numberField(data[field] ?? data[alias]);
  if (Object.prototype.hasOwnProperty.call(data, 'stock')) payload.stock = numberField(data.stock);
  if (Object.prototype.hasOwnProperty.call(data, 'weight')) payload.weight = numberField(data.weight, null);
  return payload;
};

export const productsService = {
  list: (companyId) => productsRepository.list(companyId),
  create: (companyId, data) => {
    const normalizedData = { ...data, sku: data.sku?.trim() || undefined, barcode: data.barcode?.trim() || undefined };
    const parsed = productSchema.parse({ ...normalizedData, company_id: companyId, price: normalizedData.price ?? normalizedData.sale_price, cost: normalizedData.cost ?? normalizedData.cost_price, minimum_stock: normalizedData.minimum_stock ?? normalizedData.min_stock });
    const payload = isSupabase() ? { ...parsed, sku: parsed.sku?.trim() || null, barcode: parsed.barcode?.trim() || null, subcategory: parsed.subcategory || parsed.category || undefined, commission_rate: parsed.commission ?? parsed.commission_rate } : {
      ...parsed,
      sale_price: parsed.price,
      cost_price: parsed.cost,
      min_stock: parsed.minimum_stock,
    };
    if (parsed.item_type === 'service') { payload.stock = 0; payload.minimum_stock = 0; }
    return createWithAvailableSku(companyId, payload);
  },
  update: async (companyId, id, data = {}) => {
    const current = await productsRepository.get(id, companyId);
    const canonicalPayload = productPayload(companyId, data);
    if ((data.item_type || current.item_type) === 'service') { canonicalPayload.item_type = 'service'; canonicalPayload.stock = 0; canonicalPayload.minimum_stock = 0; }
    const payload = isSupabase() ? canonicalPayload : { ...canonicalPayload, sale_price: canonicalPayload.price, cost_price: canonicalPayload.cost, min_stock: canonicalPayload.minimum_stock, commission: canonicalPayload.commission_rate };
    const updated = await productsRepository.update(id, payload, companyId);
    if (Object.prototype.hasOwnProperty.call(payload, 'stock') && Number(payload.stock) !== Number(current.stock)) {
      await inventoryRepository.create({ product_id: id, type: 'adjust', quantity: Number(payload.stock) - Number(current.stock || 0), reason: 'Ajuste de estoque na edição do produto' }, companyId);
    }
    return updated;
  },
  // Catalog rows are referenced by sales, stock, purchases and production and
  // authenticated users intentionally have no DELETE grant. Archive instead:
  // it disappears from active operations while preserving the audit trail.
  remove: async (companyId, id) => {
    const archived = await productsService.update(companyId, id, { active: false });
    return { ...archived, archived: true };
  },
};
