export function toDateTimeLocalValue(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

export function dateTimeLocalToISOString(value) {
  if (typeof value !== 'string' || !value.trim()) throw new Error('AI_FINANCIAL_CONFIG_INVALID');
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Error('AI_FINANCIAL_CONFIG_INVALID');
  return parsed.toISOString();
}
