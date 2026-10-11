const STOP_WORDS = /\b(temos|tem|tenho|quanto|custa|preco|preço|valor|estoque|unidades|disponivel|disponível|produtos?|qual|quais|variacao|variação|tamanho|cor|monte|crie|pedido|rascunho|para|com|do|da|de|o|a|um|uma|cliente|fornecedor)\b/gi;

export function productSearchTerm(message) {
  const text = String(message || '').replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);
  if (/^(?=.*\d)[a-z0-9_-]+$/i.test(text)) return text;
  return text.replace(STOP_WORDS, ' ').replace(/[?!.,;:]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);
}
