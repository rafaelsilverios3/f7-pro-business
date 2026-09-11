import { productsRepository } from '@/data/repositories/productsRepository';
import { inventoryRepository } from '@/data/repositories/inventoryRepository';
import { productSchema } from '@/schemas';

const isSupabase = () => import.meta.env.VITE_DATA_PROVIDER === 'supabase';
const numberField = (value, fallback = 0) => value === '' || value == null ? fallback : Number(value);
const productPayload = (companyId, data = {}) => {
  const payload = { company_id: companyId };
  const textFields = ['name', 'sku', 'barcode', 'subcategory', 'brand', 'description', 'short_description', 'full_description', 'material', 'color', 'size', 'model', 'unit', 'dimensions', 'tags', 'keywords', 'featured', 'active'];
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
    const parsed = productSchema.parse({ ...data, company_id: companyId, price: data.price ?? data.sale_price, cost: data.cost ?? data.cost_price, minimum_stock: data.minimum_stock ?? data.min_stock });
    const payload = isSupabase() ? { ...parsed, subcategory: parsed.subcategory || parsed.category || undefined, commission_rate: parsed.commission ?? parsed.commission_rate } : {
      ...parsed,
      sale_price: parsed.price,
      cost_price: parsed.cost,
      min_stock: parsed.minimum_stock,
    };
    return productsRepository.create(payload, companyId);
  },
  update: async (companyId, id, data = {}) => {
    const current = await productsRepository.get(id, companyId);
    const canonicalPayload = productPayload(companyId, data);
    const payload = isSupabase() ? canonicalPayload : { ...canonicalPayload, sale_price: canonicalPayload.price, cost_price: canonicalPayload.cost, min_stock: canonicalPayload.minimum_stock, commission: canonicalPayload.commission_rate };
    const updated = await productsRepository.update(id, payload, companyId);
    if (Object.prototype.hasOwnProperty.call(payload, 'stock') && Number(payload.stock) !== Number(current.stock)) {
      await inventoryRepository.create({ product_id: id, type: 'adjust', quantity: Number(payload.stock) - Number(current.stock || 0), reason: 'Ajuste de estoque na edição do produto' }, companyId);
    }
    return updated;
  },
  remove: (companyId, id) => productsRepository.remove(id, companyId),
};
