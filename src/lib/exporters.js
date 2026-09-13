const FORMULA_PREFIX = /^[=+\-@]/;

export function escapeSpreadsheetCell(value) {
  const text = value === null || value === undefined ? '' : String(value);
  // Prefixing with an apostrophe keeps spreadsheet applications from
  // evaluating formulas while preserving the visible value.
  return FORMULA_PREFIX.test(text) ? `'${text}` : text;
}

export function escapeCsvCell(value) {
  const text = escapeSpreadsheetCell(value);
  return /[";\n\r,]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function serializeCsv(headers = [], rows = []) {
  return [headers, ...rows].map((row) => row.map(escapeCsvCell).join(';')).join('\r\n');
}

export function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function buildTableHtml(headers = [], rows = []) {
  const head = headers.map((header) => `<th>${escapeHtml(header)}</th>`).join('');
  const body = rows.map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join('')}</tr>`).join('');
  return `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

export function buildPrintableHtml(title, tableHtml) {
  return `<html><head><title>${escapeHtml(title)}</title><style>body{font-family:sans-serif;padding:20px}table{width:100%;border-collapse:collapse}th,td{border:1px solid #ddd;padding:8px;text-align:left;font-size:12px}th{background:#f5f5f5}h1{font-size:18px}</style></head><body><h1>${escapeHtml(title)}</h1>${tableHtml}</body></html>`;
}
