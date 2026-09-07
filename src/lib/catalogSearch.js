const text = (value) => String(value ?? '').trim().toLocaleLowerCase('pt-BR');

function includesValue(value, query) {
  if (!query) return true;
  if (Array.isArray(value)) return value.some((item) => text(item).includes(text(query)));
  if (value && typeof value === 'object') return Object.entries(value).some(([key, item]) => `${key} ${item}`.toLocaleLowerCase('pt-BR').includes(text(query)));
  return text(value).includes(text(query));
}

export function matchesCatalogFilters(product, filters = {}) {
  if (filters.activeOnly !== false && product.active === false) return false;
  const searchable = [product.name, product.sku, product.barcode, product.category, product.subcategory, product.brand, product.description, product.short_description, product.full_description, product.material, product.color, product.size, product.model, product.tags, product.keywords, product.attributes];
  if (filters.query && !searchable.some((value) => includesValue(value, filters.query))) return false;
  for (const field of ['category', 'brand', 'size', 'color', 'material', 'model']) {
    if (filters[field] && !includesValue(product[field], filters[field])) return false;
  }
  if (filters.attributes && !includesValue(product.attributes, filters.attributes)) return false;
  const price = Number(product.price ?? product.sale_price ?? 0);
  const stock = Number(product.stock ?? 0);
  if (filters.minPrice != null && price < Number(filters.minPrice)) return false;
  if (filters.maxPrice != null && price > Number(filters.maxPrice)) return false;
  if (filters.inStock !== false && stock <= 0) return false;
  if (filters.minStock != null && stock < Number(filters.minStock)) return false;
  return true;
}

export function toCatalogOption(product, extra = {}) {
  const price = Number(extra.price ?? product.price ?? product.sale_price ?? 0);
  const stock = Number(extra.stock ?? product.stock ?? 0);
  return {
    id: extra.variant_id || product.id,
    product_id: product.id,
    variant_id: extra.variant_id || null,
    name: extra.name ? `${product.name} — ${extra.name}` : product.name,
    short_description: product.short_description || product.description || '',
    price,
    stock,
    images: extra.images || [],
    attributes: { ...(product.attributes || {}), ...(extra.attributes || {}) },
    sku: extra.sku || product.sku || '',
  };
}

export function numberCatalogOptions(options = []) {
  return options.map((option, index) => ({ ...option, selection_number: index + 1 }));
}
