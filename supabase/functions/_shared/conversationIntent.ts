const PART_PATTERNS = [
  /filtro\s+(?:de\s+)?combust[ií]vel/iu,
  /filtro\s+(?:de\s+)?[oó]leo/iu,
  /filtro\s+(?:de\s+)?ar/iu,
  /bomba\s+(?:hidr[aá]ulica|de\s+[aá]gua|de\s+combust[ií]vel)?/iu,
  /correia(?:\s+(?:do|da|de)\s+)?[\p{L}-]+(?:\s+[\p{L}-]+){0,2}/iu,
  /radiador/iu,
  /alternador/iu,
  /rolamento/iu,
];

function clean(value: unknown, max = 300) {
  return String(value || '').replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

export type IntentMessage = { id?: string; sender_type?: string; role?: string; direction?: string; content?: string; created_at?: string; [key: string]: unknown };
export type ConversationIntent = {
  latestCustomerMessage: { id: string | null; content: string };
  currentRequest: string;
  conversationHistory: IntentMessage[];
  previousIntent: Record<string, unknown> | null;
  intentChanged: boolean;
  activeIntent: { manufacturer?: string; model?: string; requestedPart: string; normalizedRequestedPart: string };
  invalidations: string[];
};

export function normalizeRequestedPart(value: unknown) {
  return clean(value, 180).toLocaleLowerCase('pt-BR').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ');
}

/** Convert the different message shapes used by the inbox/providers to one safe shape. */
export function normalizeIntentMessages(rows: unknown): IntentMessage[] {
  if (!Array.isArray(rows)) return [];
  return rows.map((raw: any) => {
    if (!raw || typeof raw !== 'object') return null;
    const direction = clean(raw.direction || raw.message_direction, 30).toLowerCase();
    const rawSender = clean(raw.sender_type || raw.sender || raw.role, 40).toLowerCase();
    const sender_type = direction === 'inbound' || direction === 'received' || direction === 'customer'
      ? 'customer'
      : direction === 'outbound' || direction === 'sent' || direction === 'agent'
        ? 'agent'
        : ['customer', 'client', 'contact', 'lead'].includes(rawSender)
          ? 'customer'
          : ['agent', 'human_agent', 'attendant', 'assistant'].includes(rawSender)
            ? 'agent'
            : rawSender || 'system';
    const content = clean(raw.content ?? raw.body ?? raw.message ?? raw.text, 1000);
    if (!content) return null;
    return { id: raw.id == null ? undefined : String(raw.id), sender_type, content, created_at: raw.created_at == null ? undefined : String(raw.created_at) };
  }).filter(Boolean) as IntentMessage[];
}

export function extractRequestedPart(text: unknown) {
  const value = clean(text, 1000);
  for (const pattern of PART_PATTERNS) {
    const match = value.match(pattern)?.[0];
    if (match) return clean(match, 180);
  }
  return clean(value.match(/(?:peca|peça|filtro|bomba|correia|rolamento)\s+(?:de\s+)?([\p{L}0-9 -]{3,60})/iu)?.[0] || '', 180);
}

export function extractMachine(text: unknown) {
  const value = clean(text, 1000);
  const model = value.match(/\b(?=[A-Z0-9 -]{3,12}\b)(?=[A-Z0-9 -]*[A-Z])(?=[A-Z0-9 -]*\d)[A-Z]{0,3}\s*\d{2,5}[A-Z]?\b/i)?.[0];
  const manufacturer = value.match(/\b(?:fabricante|marca)\s*[:=-]?\s*([\p{L}][\p{L}-]+(?:\s+[\p{L}][\p{L}-]+){0,2})/iu)?.[1]
    || (/john\s*deere/i.test(value) ? 'John Deere' : undefined);
  return { manufacturer: clean(manufacturer, 120) || undefined, model: clean(model, 80) || undefined };
}

export function resolveConversationIntent(messages: IntentMessage[] = [], previousIntent: Record<string, unknown> | null = null): ConversationIntent {
  const normalized = normalizeIntentMessages(messages);
  const ordered = normalized.slice().sort((a, b) => {
    const aTime = Date.parse(String(a.created_at || ''));
    const bTime = Date.parse(String(b.created_at || ''));
    return (Number.isFinite(bTime) ? bTime : 0) - (Number.isFinite(aTime) ? aTime : 0);
  });
  const customer = ordered.find((item) => item.sender_type === 'customer' && clean(item.content));
  const latest = { id: customer?.id ? String(customer.id) : null, content: clean(customer?.content, 1000) };
  const latestPart = extractRequestedPart(latest.content);
  const previousPart = clean(previousIntent?.normalizedRequestedPart || previousIntent?.requestedPart || previousIntent?.part_description, 180);
  const currentRequest = latestPart || (previousPart ? clean(previousIntent?.requestedPart || previousPart, 180) : latest.content);
  const machine = extractMachine(latest.content);
  const previousModel = clean(previousIntent?.model, 80) || undefined;
  const previousManufacturer = clean(previousIntent?.manufacturer, 120) || undefined;
  const normalizedRequestedPart = normalizeRequestedPart(currentRequest);
  const intentChanged = Boolean(previousPart && latestPart && normalizeRequestedPart(latestPart) !== normalizeRequestedPart(previousPart));
  const conversationHistory = ordered.filter((item) => item !== customer).map((item) => ({ id: item.id, sender_type: item.sender_type, content: clean(item.content, 600), created_at: item.created_at }));
  return {
    latestCustomerMessage: latest,
    currentRequest,
    conversationHistory,
    previousIntent,
    intentChanged,
    activeIntent: { manufacturer: machine.manufacturer || previousManufacturer, model: machine.model || previousModel, requestedPart: currentRequest, normalizedRequestedPart },
    invalidations: intentChanged ? ['old_candidates', 'selected_candidate', 'research_results', 'ranking', 'application', 'confidence', 'recommendation', 'pending_question'] : [],
  };
}

export function buildResearchQuery(intent: ConversationIntent, region = '') {
  return clean([intent.activeIntent.manufacturer, intent.activeIntent.model, intent.currentRequest, region].filter(Boolean).join(' '), 500);
}

export function researchCacheKey(input: { company_id: string; manufacturer?: string; model?: string; requested_part: string; region?: string; strategy_version: string }) {
  return [input.company_id, input.manufacturer, input.model, normalizeRequestedPart(input.requested_part), clean(input.region, 80), input.strategy_version].map((item) => clean(item, 180).toLocaleLowerCase('pt-BR')).join('|');
}
