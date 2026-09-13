/**
 * Shared period and metric primitives.  Date-only records are interpreted in
 * the supplied timezone; persisted timestamps remain untouched.
 */
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const pad = (value) => String(value).padStart(2, '0');
const isoDate = (year, month, day) => `${year}-${pad(month)}-${pad(day)}`;

function zonedDateParts(value, timezone) {
  const date = value instanceof Date ? value : new Date(value || Date.now());
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date);
  const result = Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
  return { year: Number(result.year), month: Number(result.month), day: Number(result.day) };
}

function dateOnly(value, timezone) {
  if (!value) return null;
  if (typeof value === 'string' && DATE_RE.test(value.slice(0, 10))) return value.slice(0, 10);
  const parts = zonedDateParts(value, timezone);
  return parts ? isoDate(parts.year, parts.month, parts.day) : null;
}

function shiftDays(dateString, amount) {
  const date = new Date(`${dateString}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return isoDate(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function resolveTimezone(timezone) {
  if (typeof timezone === 'string' && timezone.trim()) return timezone;
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; }
}

export function createPeriodContext({ companyId, periodKey = 'month', timezone, now = new Date(), startDate, endDate } = {}) {
  if (!companyId) throw new Error('company_id é obrigatório para métricas.');
  const tz = resolveTimezone(timezone);
  const today = dateOnly(now, tz);
  let start = startDate || null;
  let end = endDate || null;
  const [year, month] = today.split('-').map(Number);
  if (periodKey === 'today' || periodKey === 'day') start = end = today;
  else if (periodKey === '7d') { end = today; start = shiftDays(today, -6); }
  else if (periodKey === '30d') { end = today; start = shiftDays(today, -29); }
  else if (periodKey === 'month') { start = isoDate(year, month, 1); end = isoDate(year, month, daysInMonth(year, month)); }
  else if (periodKey === 'quarter') {
    const firstMonth = Math.floor((month - 1) / 3) * 3 + 1;
    start = isoDate(year, firstMonth, 1);
    end = isoDate(year, firstMonth + 2, daysInMonth(year, firstMonth + 2));
  } else if (periodKey === 'year') { start = isoDate(year, 1, 1); end = isoDate(year, 12, 31); }
  else if (periodKey === 'all') { start = null; end = null; }
  else if (periodKey === 'custom' && (!start || !end)) throw new Error('Período custom exige start_date e end_date.');
  if (periodKey === 'custom' && start > end) throw new Error('A data inicial deve ser anterior ou igual à data final.');
  return Object.freeze({ company_id: companyId, start_date: start, end_date: end, timezone: tz, period_key: periodKey });
}

/** Return the immediately preceding comparable period, or null for snapshots/all-time. */
export function previousPeriodContext(periodContext) {
  if (!periodContext?.company_id || periodContext.period_key === 'all' || !periodContext.start_date || !periodContext.end_date) return null;
  const start = new Date(`${periodContext.start_date}T12:00:00Z`);
  const end = new Date(`${periodContext.end_date}T12:00:00Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
  const days = Math.max(1, Math.round((end - start) / 86_400_000) + 1);
  const previousEnd = shiftDays(periodContext.start_date, -1);
  const previousStart = shiftDays(previousEnd, -days + 1);
  return Object.freeze({
    company_id: periodContext.company_id,
    start_date: previousStart,
    end_date: previousEnd,
    timezone: periodContext.timezone,
    period_key: 'previous',
  });
}

/** Deterministic comparison used by executive KPI cards. Never emits Infinity/NaN. */
export function compareMetric(current, previous) {
  const currentValue = Number(current);
  const previousValue = Number(previous);
  if (!Number.isFinite(currentValue) || !Number.isFinite(previousValue)) return { current: null, previous: null, delta: null, delta_percent: null, state: 'unavailable' };
  const delta = currentValue - previousValue;
  if (previousValue === 0) return { current: currentValue, previous: previousValue, delta, delta_percent: null, state: currentValue === 0 ? 'neutral' : 'new' };
  return { current: currentValue, previous: previousValue, delta, delta_percent: (delta / Math.abs(previousValue)) * 100, state: delta === 0 ? 'neutral' : delta > 0 ? 'positive' : 'negative' };
}

export function matchesPeriod(value, periodContext) {
  if (!periodContext || periodContext.period_key === 'all') return true;
  const date = dateOnly(value, periodContext.timezone);
  return Boolean(date && periodContext.start_date && periodContext.end_date && date >= periodContext.start_date && date <= periodContext.end_date);
}

export function filterByPeriod(rows = [], field, periodContext) {
  if (!periodContext || periodContext.period_key === 'all') return [...rows];
  return rows.filter((row) => matchesPeriod(row?.[field], periodContext));
}

export function metricMeta(source, periodContext, semanticType) {
  return { source, updated_at: new Date().toISOString(), period: periodContext, semantic_type: semanticType };
}

export function safeMargin(profit, revenue) {
  const total = Number(revenue) || 0;
  return total > 0 ? (Number(profit) || 0) / total * 100 : 0;
}

export function projectionForPeriod(value, periodContext, now = new Date()) {
  const amount = Number(value) || 0;
  if (!periodContext || periodContext.period_key === 'all') return { value: amount, label: 'Total histórico', semantic_type: 'period_total' };
  const key = periodContext.period_key;
  if (key === 'day' || key === 'today') return { value: amount, label: 'Total do dia', semantic_type: 'period_total' };
  const today = dateOnly(now, periodContext.timezone);
  const current = new Date(`${today}T12:00:00Z`);
  const start = new Date(`${periodContext.start_date}T12:00:00Z`);
  const elapsed = Math.max(1, Math.floor((current - start) / 86_400_000) + 1);
  const totalDays = Math.max(1, Math.floor((new Date(`${periodContext.end_date}T12:00:00Z`) - start) / 86_400_000) + 1);
  const multiplier = key === 'month' || key === 'quarter' || key === 'year' ? totalDays / elapsed : 1;
  const labels = { month: 'Projeção do mês', quarter: 'Projeção do trimestre', year: 'Projeção do ano', '7d': 'Total dos 7 dias', '30d': 'Total dos 30 dias', custom: 'Projeção do período' };
  return { value: amount * multiplier, label: labels[key] || 'Total do período', semantic_type: multiplier === 1 ? 'period_total' : 'projection' };
}

export function buildCrmFunnel({ customers = [], opportunities = [], sales = [], companyId, periodContext } = {}) {
  const scoped = (row) => !companyId || row?.company_id === companyId;
  const customerRows = customers.filter(scoped);
  const opportunityRows = opportunities.filter(scoped).filter((row) => !periodContext || periodContext.period_key === 'all' || matchesPeriod(row.created_date || row.created_at, periodContext));
  const saleRows = sales.filter(scoped).filter((row) => row.status !== 'cancelled' && matchesPeriod(row.sale_date || row.created_at, periodContext));
  return {
    leads: customerRows.filter((row) => row.status === 'lead' && matchesPeriod(row.created_date || row.created_at, periodContext)).length,
    ativos: customerRows.filter((row) => row.status === 'active' && matchesPeriod(row.created_date || row.created_at, periodContext)).length,
    oportunidades: opportunityRows.filter((row) => !['won', 'lost'].includes(row.stage)).length,
    vendas: saleRows.length,
    meta: metricMeta('supabase', periodContext, 'period_total'),
  };
}

export function buildEvolution(sales = [], periodContext, now = new Date()) {
  const valid = sales.filter((row) => row?.status !== 'cancelled');
  const key = periodContext?.period_key || 'month';
  const bucket = (row) => dateOnly(row.sale_date || row.created_at, periodContext?.timezone || resolveTimezone());
  const groups = new Map();
  valid.filter((row) => matchesPeriod(row.sale_date || row.created_at, periodContext)).forEach((row) => {
    const date = bucket(row);
    if (!date) return;
    const group = key === 'year' || key === 'quarter' || key === 'all' ? date.slice(0, 7) : date;
    const current = groups.get(group) || { faturamento: 0, lucro: 0 };
    current.faturamento += Number(row.total) || 0;
    current.lucro += Number(row.profit) || 0;
    groups.set(group, current);
  });
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([label, values]) => ({ mes: label, ...values }));
}

function periodGranularity(periodContext) {
  const key = periodContext?.period_key;
  if (key === 'day' || key === 'today') return 'hour';
  if (key === '7d' || key === '30d' || key === 'month' || key === 'custom') return 'day';
  return 'month';
}

function bucketLabel(value, periodContext) {
  const date = dateOnly(value, periodContext?.timezone || resolveTimezone());
  if (!date) return null;
  if (periodGranularity(periodContext) === 'month') return date.slice(0, 7);
  if (periodGranularity(periodContext) === 'hour') {
    const parsed = value instanceof Date ? value : new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : new Intl.DateTimeFormat('pt-BR', { timeZone: periodContext?.timezone || resolveTimezone(), hour: '2-digit' }).format(parsed);
  }
  return date;
}

function aggregateRevenueRows(rows, periodContext) {
  const groups = new Map();
  rows.filter((row) => row?.company_id === periodContext?.company_id && row?.status !== 'cancelled' && matchesPeriod(row.sale_date || row.created_at, periodContext)).forEach((row) => {
    const label = bucketLabel(row.sale_date || row.created_at, periodContext);
    if (!label) return;
    const current = groups.get(label) || { label, faturamento: 0, lucro: 0, vendas: 0, ticket_medio: 0 };
    current.faturamento += Number(row.total) || 0;
    current.lucro += Number(row.profit) || 0;
    current.vendas += 1;
    groups.set(label, current);
  });
  return [...groups.values()].sort((a, b) => a.label.localeCompare(b.label)).map((row) => ({ ...row, ticket_medio: row.vendas ? row.faturamento / row.vendas : 0 }));
}

/** Builds a sparse, real-data revenue series and an ordinal previous comparison. */
export function buildRevenueSeries(sales = [], periodContext) {
  const current = aggregateRevenueRows(sales, periodContext);
  if (!current.length) return { rows: [], current, previous: [], comparable: false, granularity: periodGranularity(periodContext) };
  const previousContext = previousPeriodContext(periodContext);
  const previous = previousContext ? aggregateRevenueRows(sales, previousContext) : [];
  const rows = current.map((row, index) => ({
    label: row.label,
    faturamento: row.faturamento,
    vendas: row.vendas,
    ticket_medio: row.ticket_medio,
    faturamento_anterior: previous[index]?.faturamento ?? null,
    vendas_anterior: previous[index]?.vendas ?? null,
    ticket_medio_anterior: previous[index]?.ticket_medio ?? null,
  }));
  return { rows, current, previous, comparable: Boolean(previousContext), granularity: periodGranularity(periodContext) };
}

export function buildAbcRows(sales = [], periodContext) {
  const productTotals = new Map();
  sales.filter((row) => row?.status !== 'cancelled' && matchesPeriod(row.sale_date || row.created_at, periodContext)).forEach((sale) => {
    (sale.items || []).forEach((item) => productTotals.set(item.name, (productTotals.get(item.name) || 0) + (Number(item.total) || 0)));
  });
  const sorted = [...productTotals.entries()].sort((a, b) => b[1] - a[1]);
  const total = sorted.reduce((sum, [, value]) => sum + value, 0);
  let cumulative = 0;
  return sorted.map(([name, value]) => {
    cumulative += value;
    const share = total > 0 ? value / total * 100 : 0;
    const cumulativeShare = total > 0 ? cumulative / total * 100 : 0;
    return { name, value, share, cumulative_share: cumulativeShare, classification: cumulativeShare <= 80 ? 'A' : cumulativeShare <= 95 ? 'B' : 'C' };
  });
}
