import { customersRepository } from '@/data/repositories/customersRepository';
import { productsRepository } from '@/data/repositories/productsRepository';
import { quotesRepository } from '@/data/repositories/quotesRepository';
import { salesRepository } from '@/data/repositories/salesRepository';
import { purchasesRepository } from '@/data/repositories/purchasesRepository';
import { suppliersRepository } from '@/data/repositories/suppliersRepository';
import { createRepository } from '@/data/repositoryFactory';
import { can } from '@/lib/permissions';
import { searchSourceRows } from '@/lib/globalSearch';

const opportunitiesRepository = createRepository('Opportunity');

const SOURCES = [
  { key: 'customers', label: 'Clientes', permission: 'customers.view', route: '/clientes', repository: customersRepository, fields: ['name', 'document', 'email', 'phone'], title: (row) => row.name || 'Cliente sem nome', subtitle: (row) => row.phone || row.email || 'Cliente' },
  { key: 'products', label: 'Produtos', permission: 'products.view', route: '/produtos', repository: productsRepository, fields: ['name', 'sku', 'barcode', 'subcategory', 'brand', 'model'], title: (row) => row.name || 'Produto sem nome', subtitle: (row) => row.sku || row.barcode || 'Produto' },
  { key: 'quotes', label: 'Orçamentos', permission: 'quotes.view', route: '/orcamentos', repository: quotesRepository, fields: ['id', 'number', 'code', 'customer_name', 'status'], title: (row) => row.number || row.code || `Orçamento ${String(row.id || '').slice(0, 8)}`, subtitle: (row) => row.customer_name || 'Orçamento' },
  { key: 'sales', label: 'Vendas', permission: 'sales.view', route: '/vendas', repository: salesRepository, fields: ['id', 'number', 'code', 'customer_name', 'customer', 'seller', 'status'], title: (row) => row.number || row.code || `Venda ${String(row.id || '').slice(0, 8)}`, subtitle: (row) => row.customer_name || row.customer || 'Venda' },
  { key: 'purchases', label: 'Compras', permission: 'purchases.view', route: '/compras', repository: purchasesRepository, fields: ['id', 'number', 'code', 'supplier_name', 'supplier_id', 'status'], title: (row) => row.number || row.code || `Compra ${String(row.id || '').slice(0, 8)}`, subtitle: (row) => row.supplier_name || 'Pedido de compra' },
  { key: 'suppliers', label: 'Fornecedores', permission: 'purchases.view', route: '/compras', repository: suppliersRepository, fields: ['name', 'document', 'email', 'phone'], title: (row) => row.name || 'Fornecedor sem nome', subtitle: (row) => row.phone || row.email || 'Fornecedor' },
  { key: 'opportunities', label: 'Oportunidades', permission: 'opportunity.view', route: '/opportunity-radar', repository: opportunitiesRepository, fields: ['title', 'description', 'stage', 'source'], title: (row) => row.title || 'Oportunidade sem título', subtitle: (row) => row.stage || row.source || 'Oportunidade' },
];

export async function searchGlobal(companyId, query, { role = 'admin', limit = 5 } = {}) {
  const text = String(query || '').trim();
  if (!companyId || text.length < 2) return [];
  const sources = SOURCES.filter((source) => can({ role }, source.permission));
  const settled = await Promise.allSettled(sources.map(async (source) => ({ source, rows: await source.repository.list(companyId, '-created_date', 100) })));
  return settled.flatMap((result) => result.status === 'fulfilled' ? searchSourceRows(result.value.rows, result.value.source, text, limit) : []);
}

export const GLOBAL_SEARCH_SOURCES = SOURCES.map(({ key, label, permission, route }) => ({ key, label, permission, route }));
