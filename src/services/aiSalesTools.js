import { can } from '@/lib/permissions';
import { searchCatalog } from '@/services/smartCatalogService';
import { createConversationDraft } from '@/services/conversationOrderService';
import { productsRepository } from '@/data/repositories/productsRepository';
import { salesRepository } from '@/data/repositories/salesRepository';
import { customersRepository } from '@/data/repositories/customersRepository';
import { opportunitiesService } from '@/services/opportunitiesService';
import { supplierIntelligenceService } from '@/services/supplierIntelligenceService';
import { marketIntelligenceService } from '@/services/marketIntelligenceService';
import { salesHubService } from '@/services/salesHubService';

const requireToolAccess = (user, permission = 'ai_sales.use') => { if (!can(user, permission)) throw new Error('Você não tem permissão para usar esta ferramenta.'); };
export const AI_TOOL_NAMES = Object.freeze(['buscar_produto', 'consultar_estoque', 'consultar_preco', 'listar_variacoes', 'buscar_cliente', 'criar_rascunho_pedido', 'consultar_pedido', 'buscar_oportunidades', 'consultar_fornecedor', 'analisar_ofertas_fornecedor', 'consultar_canais']);
export function createAiSalesTools({ companyId, user }) {
  if (!companyId) throw new Error('Empresa não identificada.');
  requireToolAccess(user);
  const requirePermission = (permission) => requireToolAccess(user, permission);
  return {
    buscar_produto: (filters) => { requirePermission('catalog.view'); return searchCatalog(companyId, { ...filters, inStock: true, activeOnly: true }); },
    consultar_estoque: async ({ productId }) => { requirePermission('catalog.view'); const product = await productsRepository.get(productId, companyId); return { product_id: product.id, name: product.name, stock: Number(product.stock || 0), available: Number(product.stock || 0) > 0 }; },
    consultar_preco: async ({ productId }) => { requirePermission('catalog.view'); const product = await productsRepository.get(productId, companyId); return { product_id: product.id, name: product.name, price: Number(product.price ?? product.sale_price ?? 0), currency: 'BRL' }; },
    listar_variacoes: async ({ productId }) => { requirePermission('catalog.view'); return (await searchCatalog(companyId, { inStock: true, activeOnly: true, limit: 500 })).filter((item) => item.product_id === productId && item.variant_id); },
    buscar_cliente: async ({ query }) => { requirePermission('customers.view'); return (await customersRepository.list(companyId, 'name')).filter((customer) => `${customer.name} ${customer.email || ''} ${customer.phone || ''}`.toLocaleLowerCase('pt-BR').includes(String(query || '').toLocaleLowerCase('pt-BR'))).slice(0, 20); },
    criar_rascunho_pedido: ({ option, quantity, conversationId, customerId }) => { requirePermission('orders.create_from_conversation'); return createConversationDraft({ companyId, option, quantity, conversationId, customerId }); },
    consultar_pedido: ({ orderId }) => { requirePermission('sales.view'); return salesRepository.get(orderId, companyId); },
    buscar_oportunidades: () => { requirePermission('opportunity.view'); return opportunitiesService.list(companyId); },
    consultar_fornecedor: () => { requirePermission('supplier_intelligence.view'); return supplierIntelligenceService.list(companyId); },
    consultar_canais: () => { requirePermission('sales_channels.view'); return salesHubService.listChannels(companyId); },
  };
}
