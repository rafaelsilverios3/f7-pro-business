const normalize = (value) => String(value || '').toLocaleLowerCase('pt-BR').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim();

/** Route only intents backed by an existing read tool or by bounded text generation. */
export function classifyAiSalesIntent(message) {
  const text = normalize(message);
  if (/\b(escreva|escrever|redija|redigir|crie|criar|prepare|preparar|monte|montar)\b/.test(text) && /\b(mensagem|texto|email|e-mail|whatsapp|legenda|convite|apresentacao|follow.?up|carrinho abandonado|oferta|anuncio|promocao)\b/.test(text)) return 'message_draft';
  if (/\b(encontre novos fornecedores|novos fornecedores|pesquise fornecedor|pesquisar fornecedor|fornecedor externo)\b/.test(text)) return 'supplier_external';
  if (/\b(oferta(s)? de fornecedor(es)?|oferta(s)? do fornecedor(es)?|oferta(s)? aprovadas?|custo(s)? de fornecedor(es)?|compar(ar|e|acao) oferta|rentabilidade.*fornecedor(es)?|fornecedor(es)?.*rentabilidade|margem.*fornecedor(es)?|simul(e|ar).*fornecedor(es)?)\b/.test(text)) return 'supplier_offer_pricing';
  if (/\bfornecedor(es)?\b/.test(text)) return 'supplier';
  if (/\b(cana(?:l|is)|whatsapp|marketplace|loja online)\b/.test(text)) return 'channels';
  if (/\b(oportunidade|oportunidades|merecem contato|recompra)\b/.test(text)) return 'opportunities';
  if (/\b(vendas?|faturamento|desempenho comercial|resultado comercial|ticket medio)\b/.test(text) && /\b(analise|analisar|desempenho|resultado|faturamento|total|resumo|como estao|como foram)\b/.test(text)) return 'sales_analysis';
  if (/\b(cliente|ultimo pedido dele|ultima compra dele)\b/.test(text) && /\b(pedido|compra|telefone|procure|buscar|encontre|quem)\b/.test(text)) return /\b(pedido|compra)\b/.test(text) ? 'customer_order' : 'customer';
  if (/\b(rascunho|monte .*pedido|crie .*pedido|pedido para)\b/.test(text)) return 'draft';
  if (/\b(variac|tamanho|cor|modelo dispon)\b/.test(text)) return 'variations';
  if (/\b(estoque|quantas unidades|disponibil)\b/.test(text)) return 'stock';
  if (/\b(preco|custa|valor)\b/.test(text)) return 'price';
  if (/\b(produtos?|catalogo|sku|codigo do produto)\b/.test(text) && /\b(quais|qual|temos|tem|buscar|procure|encontre|liste|listar|produto|catalogo|sku|codigo)\b/.test(text)) return 'product';
  return 'general_guidance';
}
