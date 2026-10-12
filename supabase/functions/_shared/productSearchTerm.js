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
