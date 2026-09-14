export const CRM_AUTOMATION_TRIGGERS = Object.freeze([
  'crm_activity_due_soon',
  'crm_activity_due_today',
  'crm_activity_overdue',
  'crm_opportunity_without_next_action',
  'quote_created',
  'quote_approved',
  'quote_no_response',
]);

const PENDING = 'PENDENTE';
const DAY_MS = 86_400_000;

function asDate(value: unknown) {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(String(value || ''));
  return Number.isNaN(date.getTime()) ? null : date;
}

export function safeTimezone(value: unknown) {
  const timezone = typeof value === 'string' && value.trim() ? value.trim() : 'UTC';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format();
    return timezone;
  } catch {
    return 'UTC';
  }
}

export function localDateKey(value: unknown, timezone = 'UTC') {
  const date = asDate(value);
  if (!date) return null;
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: safeTimezone(timezone), year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const values = Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function isPendingActivity(activity: any) {
  return activity?.status === PENDING;
}

export function isDueTodayActivity(activity: any, now = new Date(), timezone = 'UTC') {
  const due = asDate(activity?.due_at);
  const current = asDate(now);
  return Boolean(isPendingActivity(activity) && due && current && due.getTime() >= current.getTime() && localDateKey(due, timezone) === localDateKey(current, timezone));
}

export function isDueSoonActivity(activity: any, now = new Date(), timezone = 'UTC') {
  const due = asDate(activity?.due_at);
  const current = asDate(now);
  if (!isPendingActivity(activity) || !due || !current) return false;
  const delta = due.getTime() - current.getTime();
  return delta > 0 && delta <= DAY_MS && !isDueTodayActivity(activity, current, timezone);
}

export function isOverdueActivity(activity: any, now = new Date()) {
  const due = asDate(activity?.due_at);
  const current = asDate(now);
  return Boolean(isPendingActivity(activity) && due && current && due.getTime() < current.getTime());
}

export function isActiveOpportunity(opportunity: any) {
  if (!opportunity) return false;
  const closed = new Set(['won', 'lost', 'closed', 'cancelled', 'canceled', 'converted', 'convertida_em_produto', 'descartada', 'DESCARTADA', 'RESOLVIDA']);
  return !closed.has(String(opportunity.stage || '').toLowerCase()) && !closed.has(String(opportunity.status || '').toLowerCase());
}

export function activityMatchesTrigger(activity: any, triggerType: string, now = new Date(), timezone = 'UTC') {
  if (triggerType === 'crm_activity_due_soon') return isDueSoonActivity(activity, now, timezone);
  if (triggerType === 'crm_activity_due_today') return isDueTodayActivity(activity, now, timezone);
  if (triggerType === 'crm_activity_overdue') return isOverdueActivity(activity, now);
  return false;
}

export function signalWindowKey(signal: any, triggerType: string, timezone = 'UTC') {
  if (['quote_created', 'quote_approved'].includes(triggerType)) return `quote:${signal?.quote_id || signal?.id}`;
  if (triggerType === 'quote_no_response') return `quote:${signal?.quote_id || signal?.id}:no_response:${localDateKey(signal?.reference_at, timezone) || 'unknown'}`;
  if (triggerType === 'crm_opportunity_without_next_action') return `opportunity:${signal?.opportunity_id || signal?.id}`;
  if (triggerType === 'crm_activity_due_today') return `activity:${signal?.activity_id || signal?.id}:today:${localDateKey(signal?.due_at, timezone) || 'unknown'}`;
  if (triggerType === 'crm_activity_due_soon') return `activity:${signal?.activity_id || signal?.id}:due_soon:${new Date(signal?.due_at || 0).toISOString()}`;
  if (triggerType === 'crm_activity_overdue') return `activity:${signal?.activity_id || signal?.id}:overdue:${new Date(signal?.due_at || 0).toISOString()}`;
  return `${triggerType}:${signal?.activity_id || signal?.opportunity_id || signal?.id || 'unknown'}`;
}

export function minimalActivitySignal(activity: any) {
  return { activity_id: activity?.id || null, company_id: activity?.company_id || null, customer_id: activity?.customer_id || null, opportunity_id: activity?.opportunity_id || null, assigned_to: activity?.assigned_to || null, status: activity?.status || null, activity_type: activity?.activity_type || null, due_at: activity?.due_at || null };
}

export function minimalOpportunitySignal(opportunity: any) {
  return { opportunity_id: opportunity?.id || null, company_id: opportunity?.company_id || null, customer_id: opportunity?.customer_id || null, assigned_to: opportunity?.assigned_user_id || null, stage: opportunity?.stage || null, status: opportunity?.status || null };
}

export function minimalQuoteSignal(quote: any) {
  return { quote_id: quote?.id || null, company_id: quote?.company_id || null, customer_id: quote?.customer_id || null, assigned_to: quote?.seller_user_id || null, status: quote?.status || null, total: quote?.total || 0, reference_at: quote?.approved_at || quote?.updated_at || quote?.created_at || null };
}
