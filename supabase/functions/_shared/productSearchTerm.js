const STOP_WORDS = new Set([
  'temos', 'tem', 'tenho', 'quanto', 'custa', 'preco', 'valor', 'estoque', 'unidades',
  'disponivel', 'produto', 'produtos', 'qual', 'quais', 'variacao', 'tamanho', 'cor',
  'monte', 'crie', 'pedido', 'rascunho', 'para', 'com', 'do', 'da', 'de', 'o', 'a',
  'um', 'uma', 'cliente', 'fornecedor', 'em', 'sku',
]);

function normalizeToken(value) {
  return value.toLocaleLowerCase('pt-BR').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

export function productSearchTerm(message) {
  const text = String(message || '').replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);
  if (/^(?=.*\d)[a-z0-9_-]+$/i.test(text)) return text;
  return text
    .replace(/[?!.,;:]+/g, ' ')
    .split(/\s+/)
    .filter((token) => token && !STOP_WORDS.has(normalizeToken(token)))
    .join(' ')
    .slice(0, 120);
}

export function supplierOfferProductSearchTerm(message) {
  const query = String(message || '')
    .replace(/\b\d+(?:[.,]\d+)?\s*(?:un(?:idades?)?|unid(?:ades)?|peças?|pecas)\b/gi, ' ')
    .replace(/\b(?:quantidade|solicito|preciso|quero)\s*(?:de\s*)?\d+(?:[.,]\d+)?\b/gi, ' ')
    .replace(/(?<![a-z0-9_-])(?:compare|comparar|comparacao|comparação|ofertas?|fornecedores?|custos?|rentabilidade|margem|viabilidade|simule|simular|simulacao|simulação|aprovadas?|verificadas?|e|as?)(?![a-z0-9_-])/gi, ' ');
  return productSearchTerm(query);
}
