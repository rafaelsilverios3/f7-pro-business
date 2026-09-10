export const ASSISTANT_INTENTS = [
  'parts', 'compatibility', 'product', 'price', 'stock', 'quote', 'customer', 'crm', 'supplier', 'opportunity', 'market_research', 'general_support',
] as const;
export type AssistantIntent = typeof ASSISTANT_INTENTS[number];

const aliases: Record<string, AssistantIntent> = {
  part_research: 'parts', catalog_lookup: 'product', pricing_analysis: 'price', crm_analysis: 'crm', supplier_research: 'supplier', opportunity_analysis: 'opportunity',
  market_research: 'market_research', general: 'general_support', support: 'general_support',
};

export function normalizeAssistantIntent(value: unknown): AssistantIntent {
  const raw = String(value || '').trim().toLowerCase();
  if ((ASSISTANT_INTENTS as readonly string[]).includes(raw)) return raw as AssistantIntent;
  return aliases[raw] || 'general_support';
}

export function detectAssistantIntent(text: string): AssistantIntent {
  if (/pre[cç]o|pre[cç]ifica[cç][aã]o|margem|markup|custo/i.test(text)) return 'price';
  if (/\b(pn|p\/?n|c[oó]digo|filtro|correia|rolamento|pe[cç]a)\b/i.test(text)) return 'parts';
  if (/compatibilidade|serve para|aplica[cç][aã]o/i.test(text)) return 'compatibility';
  if (/estoque|dispon[ií]vel|quantidade/i.test(text)) return 'stock';
  if (/or[cç]amento|cot[aã][cç][aã]o/i.test(text)) return 'quote';
  if (/cliente|lead|crm|follow.?up/i.test(text)) return /crm|lead|follow/i.test(text) ? 'crm' : 'customer';
  if (/fornecedor|prazo de entrega|reputa[cç][aã]o/i.test(text)) return 'supplier';
  if (/mercado|demanda|tend[eê]ncia|concorr[eê]ncia/i.test(text)) return 'market_research';
  if (/oportunidade|potencial de venda|viabilidade/i.test(text)) return 'opportunity';
  if (/produto|modelo|cat[aá]logo/i.test(text)) return 'product';
  return 'general_support';
}
