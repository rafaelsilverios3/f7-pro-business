export type IntelligenceMode = 'internal' | 'external' | 'hybrid';

const INTERNAL_TERMS = /\b(minha empresa|meu estoque|meus produtos|meu cat[aá]logo|estoque|ruptura|baixo giro|vendas?|clientes?|compras?|produ[cç][aã]o|or[cç]amentos?|priorizar|recompra|inativos?)\b/i;
const EXTERNAL_TERMS = /\b(mercado|tend[eê]ncia|fornecedor(?:es)?|pre[cç]o|disponibilidade|concorr[eê]ncia|not[ií]cias?|em alta|pesquis[ae]|vender .*(?:produto|ssd|inform[aá]tica)|oportunidade.*mercado)\b/i;

export function classifyIntelligenceMode(query: string): IntelligenceMode {
  const text = String(query || '').trim();
  const internal = INTERNAL_TERMS.test(text);
  const external = EXTERNAL_TERMS.test(text);
  if (internal && external || /com base no que j[aá] vendo|complementar.*meu|meu cat[aá]logo.*mercado/i.test(text)) return 'hybrid';
  if (external) return 'external';
  return 'internal';
}
