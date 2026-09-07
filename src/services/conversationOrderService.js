import { searchCatalog } from '@/services/smartCatalogService';
import { salesService } from '@/services/salesService';

export function createConversationDraft({ companyId, conversationId, customerId, option, quantity = 1, paymentMethod = 'Dinheiro' }) {
  if (!companyId || !option?.product_id) throw new Error('Produto e empresa são obrigatórios.');
  const qty = Number(quantity);
  if (!Number.isInteger(qty) || qty <= 0) throw new Error('A quantidade deve ser um número inteiro positivo.');
  if (qty > Number(option.stock || 0)) throw new Error('A quantidade solicitada excede o estoque disponível.');
  return { company_id: companyId, conversation_id: conversationId || null, customer_id: customerId || null, status: 'draft', payment_method: paymentMethod, items: [{ product_id: option.product_id, variant_id: option.variant_id || undefined, name: option.name, qty, price: Number(option.price), cost: Number(option.cost || 0) }], total: Number(option.price) * qty, created_at: new Date().toISOString() };
}

export async function finalizeConfirmedConversationOrder({ draft, confirmed = false, idempotencyKey }) {
  if (!confirmed) throw new Error('Confirmação explícita do pedido é obrigatória.');
  if (!draft?.company_id || !draft.items?.length) throw new Error('Rascunho de pedido inválido.');
  const item = draft.items[0];
  const currentOptions = await searchCatalog(draft.company_id, { inStock: true, activeOnly: true, limit: 500 });
  const current = currentOptions.find((option) => option.product_id === item.product_id && (!item.variant_id || option.variant_id === item.variant_id));
  const currentStock = current?.stock || 0;
  if (currentStock < item.qty) throw new Error('O estoque mudou. Atualize o pedido antes de confirmar.');
  return salesService.finalize(draft.company_id, { customer_id: draft.customer_id, items: draft.items, payment_method: draft.payment_method, idempotency_key: idempotencyKey || `conversation:${draft.conversation_id || 'manual'}:${item.product_id}` });
}
