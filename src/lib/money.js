/**
 * Parses values typed in Brazilian monetary notation without turning invalid
 * input into zero. Empty values are represented by null so callers can show a
 * validation message instead of silently persisting the wrong amount.
 */
export function parseMoneyInput(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;

  const raw = String(value).trim().replace(/^R\$\s*/i, '').replace(/\s/g, '');
  if (!raw) return null;

  const normalized = raw.includes(',')
    ? raw.replace(/\./g, '').replace(',', '.')
    : /^\d{1,3}(?:\.\d{3})+$/.test(raw) ? raw.replace(/\./g, '') : raw;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

export function moneyOr(value, fallback = 0) {
  const parsed = parseMoneyInput(value);
  return parsed == null ? fallback : parsed;
}
