import { productsRepository } from '@/data/repositories/productsRepository';
import { listProductImages, listProductVariants } from '@/services/productCatalogService';
import { matchesCatalogFilters, numberCatalogOptions, toCatalogOption } from '@/lib/catalogSearch';

export async function searchCatalog(companyId, filters = {}) {
  if (!companyId) throw new Error('Empresa não identificada.');
  const products = await productsRepository.list(companyId, '-created_date', 500);
  const options = [];
  for (const product of products.filter((item) => matchesCatalogFilters(item, { ...filters, inStock: false }))) {
    let images = [];
    try { images = await listProductImages(companyId, product.id); } catch { /* catálogo continua sem imagem quando Storage ainda não foi configurado */ }
    let variants = [];
    try { variants = await listProductVariants(companyId, product.id); } catch { /* migration de variações é opcional nesta etapa */ }
    const availableVariants = variants.filter((variant) => Number(variant.stock || 0) > 0).filter((variant) => matchesCatalogFilters({ ...product, ...variant, price: variant.price ?? product.price }, filters));
    if (availableVariants.length) {
      availableVariants.forEach((variant) => options.push(toCatalogOption(product, { variant_id: variant.id, name: variant.name || variant.label, price: variant.price ?? product.price, stock: variant.stock, sku: variant.sku, attributes: variant.attributes, images })));
    } else if (Number(product.stock ?? 0) > 0 && matchesCatalogFilters(product, filters)) {
      options.push(toCatalogOption(product, { images }));
    }
  }
  return numberCatalogOptions(options).slice(0, filters.limit || 20);
}

export function formatCatalogOptions(options = []) {
  return options.map((item) => `${item.selection_number}. ${item.name} — R$ ${item.price.toFixed(2).replace('.', ',')} (${item.stock} em estoque)`).join('\n');
}
