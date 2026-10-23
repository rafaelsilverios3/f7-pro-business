import * as XLSX from 'xlsx';

const MONTH_NAME = new Map([
  ['JAN', '01'], ['JANEIRO', '01'], ['FEV', '02'], ['FEVEREIRO', '02'], ['FEB', '02'], ['FEBRUARY', '02'], ['MAR', '03'], ['MARCO', '03'], ['MARCH', '03'], ['ABR', '04'], ['ABRIL', '04'], ['APR', '04'], ['APRIL', '04'],
  ['MAI', '05'], ['MAIO', '05'], ['MAY', '05'], ['JUN', '06'], ['JUNHO', '06'], ['JUNE', '06'], ['JUL', '07'], ['JULHO', '07'], ['JULY', '07'], ['AGO', '08'], ['AGOSTO', '08'], ['AUG', '08'], ['AUGUST', '08'],
  ['SET', '09'], ['SETEMBRO', '09'], ['SEP', '09'], ['SEPTEMBER', '09'], ['OUT', '10'], ['OUTUBRO', '10'], ['OCT', '10'], ['OCTOBER', '10'], ['NOV', '11'], ['NOVEMBRO', '11'], ['NOVEMBER', '11'], ['DEZ', '12'], ['DEZEMBRO', '12'], ['DEC', '12'], ['DECEMBER', '12'],
]);

export function normalizeBIText(value = '') {
  return String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
}

export function scopeBIImportItems(items, { companyId, studyId, importId }) {
  return items.map((item) => {
    const row = { ...item, company_id: companyId, study_id: studyId, import_id: importId };
    delete row.id;
    return row;
  });
}

export function parseBINumber(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const raw = String(value ?? '').replace(/\s/g, '').replace(/R\$/gi, '').replace(/%/g, '');
  if (!raw) return null;
  const hasComma = raw.includes(',');
  const hasDot = raw.includes('.');
  const normalized = hasComma && hasDot
    ? (raw.lastIndexOf(',') > raw.lastIndexOf('.') ? raw.replace(/\./g, '').replace(',', '.') : raw.replace(/,/g, ''))
    : hasComma ? raw.replace(',', '.') : raw;
  const result = Number(normalized);
  return Number.isFinite(result) ? result : null;
}

export function parseBIMonth(value) {
  if (value instanceof Date && !Number.isNaN(value.valueOf())) return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}`;
  const raw = String(value ?? '').trim();
  let match = raw.match(/^(\d{1,2})[/-](\d{2,4})$/);
  if (match) {
    const month = Number(match[1]);
    const year = Number(match[2].length === 2 ? `20${match[2]}` : match[2]);
    return month >= 1 && month <= 12 ? `${year}-${String(month).padStart(2, '0')}` : null;
  }
  const namePattern = [...MONTH_NAME.keys()].sort((a, b) => b.length - a.length).join('|');
  match = normalizeBIText(raw).match(new RegExp(`^(${namePattern})\\s+(\\d{2,4})$`));
  if (!match) match = normalizeBIText(raw).match(new RegExp(`^(${namePattern})[/-](\\d{2,4})$`));
  if (match) {
    const year = Number(match[2].length === 2 ? `20${match[2]}` : match[2]);
    return `${year}-${MONTH_NAME.get(match[1])}`;
  }
  if (/^\d{4}-\d{2}$/.test(raw)) return raw;
  return null;
}

function worksheetMatrix(workbook, sheetName) {
  const sheet = workbook?.Sheets?.[sheetName];
  if (!sheet) return [];
  return XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: '', blankrows: false });
}

function detectHeader(matrix) {
  for (let index = 0; index < Math.min(matrix.length, 20); index += 1) {
    const row = matrix[index].map(normalizeBIText);
    const hasCode = row.some((cell) => /^(CODIGO|COD|SKU|ITEM|PART NUMBER|REFERENCIA)$/.test(cell));
    const hasDescription = row.some((cell) => /^(DESCRICAO|PRODUTO|ITEM DESCRICAO|NOME)$/.test(cell));
    const hasContext = row.some((cell) => /(ALERTA|MOTIVO|RAZAO|ACAO|QUANTIDADE|CONSUMO)/.test(cell));
    if (hasCode && (hasDescription || hasContext)) return { index, headers: row, rawHeaders: matrix[index].map((cell) => String(cell ?? '').trim()) };
  }
  return null;
}

function headerIndex(headers, patterns) {
  return headers.findIndex((header) => patterns.some((pattern) => pattern.test(header)));
}

function monthHeaders(headers) {
  return headers.map((label, index) => ({ index, month: parseBIMonth(label) })).filter((entry) => entry.month);
}

function cleanCode(value) {
  // Spreadsheet cells are read in display form, retaining text codes and number
  // formats such as 000123 without converting identifiers to arithmetic values.
  return String(value ?? '').trim().replace(/\s+/g, ' ');
}

function safeUnit(value, fallback) {
  return String(value ?? '').trim() || fallback || '';
}

function emptyRowMap() { return new Map(); }

export function validateBIItems(items) {
  const errors = [];
  const seen = new Set();
  if (!Array.isArray(items) || items.length === 0) return ['A planilha não contém linhas de produto válidas.'];
  if (items.length > 50000) errors.push('O arquivo excede o limite de 50.000 itens por versão.');
  for (const [index, item] of items.entries()) {
    if (!item.code) errors.push(`Linha ${index + 1}: código ausente.`);
    if (!item.unit_name) errors.push(`Linha ${index + 1}: unidade ausente.`);
    const key = `${normalizeBIText(item.unit_name)}\u0000${item.code}`;
    if (seen.has(key)) errors.push(`Linha ${index + 1}: código duplicado na unidade ${item.unit_name} (${item.code}).`);
    seen.add(key);
    for (const [month, qty] of Object.entries({ ...(item.historical_months || {}), ...(item.forecast_months || {}) })) {
      if (!/^\d{4}-\d{2}$/.test(month)) errors.push(`Linha ${index + 1}: competência inválida (${month}).`);
      if (!Number.isFinite(Number(qty)) || Number(qty) < 0) errors.push(`Linha ${index + 1}: quantidade negativa ou inválida em ${month}.`);
    }
    for (const [label, value] of [['estoque', item.stock_available], ['pedidos abertos', item.open_orders], ['valor histórico', item.historical_value], ['quantidade sugerida', item.suggested_quantity]]) {
      if (value != null && (!Number.isFinite(Number(value)) || Number(value) < 0)) errors.push(`Linha ${index + 1}: ${label} negativo ou inválido.`);
    }
  }
  return [...new Set(errors)].slice(0, 100);
}

function parseAdecoUnit(workbook, unitCode, unitName, purchaseSheetName, alertSheetName) {
  const consumptionSheetName = workbook.SheetNames.find((name) => {
    const normalized = normalizeBIText(name);
    return normalized.includes('CONSUMO') && normalized.endsWith(unitCode);
  });
  if (!consumptionSheetName) return null;
  const matrix = worksheetMatrix(workbook, consumptionSheetName);
  const detected = detectHeader(matrix);
  if (!detected) throw new Error(`Não identifiquei a linha de cabeçalho na aba ${consumptionSheetName}.`);
  const { index: headerRow, headers } = detected;
  const codeAt = headerIndex(headers, [/^(CODIGO|COD|SKU|ITEM|REFERENCIA)$/]);
  const descriptionAt = headerIndex(headers, [/^(DESCRICAO|PRODUTO|NOME)$/]);
  const abcAt = headerIndex(headers, [/^ABC(?: R)?$/]);
  const turnAt = headerIndex(headers, [/^GIRO$/]);
  const valueAt = headerIndex(headers, [/^VALOR HIST/, /^VALOR FINANCEIRO/, /^VALOR TOTAL$/]);
  const activeAt = headerIndex(headers, [/^(MESES ATIVOS|MESES COM CONSUMO)$/]);
  const staleAt = headerIndex(headers, [/^(DIAS SEM COMPRA|DIAS SEM MOVIMENTO)$/]);
  const months = monthHeaders(headers);
  const sourceRows = matrix.slice(headerRow + 1);
  const rows = new Map();
  for (const [offset, source] of sourceRows.entries()) {
    const code = cleanCode(source[codeAt]);
    if (!code) continue;
    const historical = {};
    for (const column of months) {
      const quantity = parseBINumber(source[column.index]);
      if (quantity != null) historical[column.month] = quantity;
    }
    rows.set(code, {
      company_id: null,
      unit_name: unitName,
      code,
      description: String(source[descriptionAt] ?? '').trim() || null,
      abc_class: ['A', 'B', 'C'].includes(String(source[abcAt] ?? '').trim().toUpperCase()) ? String(source[abcAt]).trim().toUpperCase() : null,
      turn_class: String(source[turnAt] ?? '').trim() || null,
      historical_value: parseBINumber(source[valueAt]),
      months_active: parseBINumber(source[activeAt]),
      days_without_purchase: parseBINumber(source[staleAt]),
      stock_available: null,
      open_orders: null,
      substitutions: [],
      historical_months: historical,
      forecast_months: {},
      suggested_quantity: null,
      net_suggested_quantity: null,
      prudence_factor: null,
      eligible_for_suggestion: false,
      review_reasons: [],
      trend_percent: null,
      trend_3m_percent: null,
      seasonality: {},
      source_reference: { workbook_model: 'adecoagro_buying_plan', worksheet: consumptionSheetName, row: headerRow + offset + 2 },
      original_recommendation: {},
    });
  }

  const purchaseName = workbook.SheetNames.find((name) => normalizeBIText(name) === normalizeBIText(purchaseSheetName));
  if (purchaseName) {
    const purchase = worksheetMatrix(workbook, purchaseName);
    const pHeader = detectHeader(purchase);
    if (pHeader) {
      const pCode = headerIndex(pHeader.headers, [/^(CODIGO|COD|SKU|ITEM|REFERENCIA)$/]);
      const forecastCols = monthHeaders(pHeader.rawHeaders).filter((entry) => entry.month >= '2026-11');
      const factorAt = headerIndex(pHeader.headers, [/^(FATOR|FACTOR|FATOR DE PRUDENCIA|PRUDENCIA)$/]);
      const pRows = purchase.slice(pHeader.index + 1);
      for (const row of pRows) {
        const code = cleanCode(row[pCode]);
        const item = rows.get(code);
        if (!item) continue;
        const factor = parseBINumber(row[factorAt]);
        if (factor != null) item.prudence_factor = factor > 1 ? factor / 100 : factor;
        let sum = 0;
        for (const col of forecastCols) {
          const qty = parseBINumber(row[col.index]);
          if (qty != null && qty > 0) { item.forecast_months[col.month] = qty; sum += qty; }
        }
        if (sum > 0) {
          item.eligible_for_suggestion = true;
          item.suggested_quantity = sum;
          item.original_recommendation = { status: 'recommended', quantity: sum, monthly: item.forecast_months, source: purchaseName };
          item.source_reference.purchase_worksheet = purchaseName;
        }
      }
    }
  }

  const alertName = workbook.SheetNames.find((name) => normalizeBIText(name) === normalizeBIText(alertSheetName));
  if (alertName) {
    const alerts = worksheetMatrix(workbook, alertName);
    const aHeader = detectHeader(alerts);
    if (aHeader) {
      const aCode = headerIndex(aHeader.headers, [/^(CODIGO|COD|SKU|ITEM|REFERENCIA)$/]);
      const reasonAt = headerIndex(aHeader.headers, [/ALERTA|MOTIVO|RAZAO|RECOMENDACAO|ACAO/]);
      for (const row of alerts.slice(aHeader.index + 1)) {
        const code = cleanCode(row[aCode]);
        const item = rows.get(code);
        if (!item) continue;
        const reason = String(row[reasonAt] ?? '').trim() || 'Incluído na aba de revisão da fonte.';
        item.review_reasons.push(reason);
        item.source_reference.alert_worksheet = alertName;
        item.source_reference.alert_reason = reason;
      }
    }
  }

  for (const item of rows.values()) {
    const numericForecast = Object.values(item.forecast_months).reduce((sum, value) => sum + Number(value || 0), 0);
    if (item.review_reasons.length) item.eligible_for_suggestion = false;
    if (item.suggested_quantity == null && numericForecast > 0) item.suggested_quantity = numericForecast;
  }
  return deriveBIFields([...rows.values()], { sourceModel: 'adecoagro_buying_plan' });
}

export function detectAdecoWorkbook(workbook) {
  const names = workbook?.SheetNames?.map(normalizeBIText) || [];
  return names.some((name) => name.includes('CONSUMO ANG')) && names.some((name) => name.includes('CONSUMO IVI'));
}

function detectSourceCutoff(workbook) {
  const name = workbook?.SheetNames?.find((sheetName) => normalizeBIText(sheetName).includes('RESUMO'));
  if (!name) return null;
  const text = worksheetMatrix(workbook, name).flat().map((value) => String(value ?? '')).join(' ').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
  const partial = text.match(/PARCIAL\s+ATE\s+(\d{1,2})[/-](\d{1,2})/);
  if (!partial) return null;
  const monthPattern = /(JANEIRO|FEVEREIRO|MARCO|ABRIL|MAIO|JUNHO|JULHO|AGOSTO|SETEMBRO|OUTUBRO|NOVEMBRO|DEZEMBRO|JAN|FEV|FEB|MAR|ABR|APR|MAI|MAY|JUN|JUL|AGO|AUG|SET|SEP|OUT|OCT|NOV|DEZ|DEC)[/-](\d{2,4})/g;
  const matchingMonth = [...text.matchAll(monthPattern)].find((match) => parseBIMonth(`${match[1]}/${match[2]}`)?.slice(5) === String(partial[2]).padStart(2, '0'));
  if (!matchingMonth) return null;
  const period = parseBIMonth(`${matchingMonth[1]}/${matchingMonth[2]}`);
  return `${period.slice(0, 4)}-${String(partial[2]).padStart(2, '0')}-${String(partial[1]).padStart(2, '0')}`;
}

export function getBIWorkbookSheets(workbook) {
  return (workbook?.SheetNames || []).map((name) => {
    const matrix = worksheetMatrix(workbook, name);
    const detected = detectHeader(matrix);
    const headers = detected?.rawHeaders || matrix[0]?.map((value) => String(value ?? '')) || [];
    return { name, headers, headerRow: detected?.index ?? 0, preview: matrix.slice((detected?.index ?? 0) + 1, (detected?.index ?? 0) + 4) };
  });
}

export function parseBIWorkbook(file) {
  if (!file) throw new Error('Selecione uma planilha.');
  if (file.size > 25 * 1024 * 1024) throw new Error('O limite por arquivo é 25 MB.');
  return file.arrayBuffer().then((buffer) => {
    const workbook = XLSX.read(buffer, { type: 'array', cellDates: true });
    const sheets = getBIWorkbookSheets(workbook);
    if (detectAdecoWorkbook(workbook)) {
      const ang = parseAdecoUnit(workbook, 'ANG', 'Angélica', 'COMPRA ANG', 'ALERTAS ANG');
      const ivi = parseAdecoUnit(workbook, 'IVI', 'Ivinhema', 'COMPRA IVI', 'ALERTAS IVI');
      const items = [...(ang || []), ...(ivi || [])];
      const errors = validateBIItems(items);
      if (errors.length) throw new Error(errors.slice(0, 8).join(' '));
      return { model: 'adecoagro_buying_plan', items, sheets, methodology: { source: 'Abas CONSUMO/COMPRA/ALERTAS da planilha; meses históricos e previsão mantidos separados; unidades não consolidadas; previsões de compra não alteram estoque ou compras.' }, source_metadata: { units: ['Angélica', 'Ivinhema'], source: 'ADECOAGRO', cutoff_hint: detectSourceCutoff(workbook) } };
    }
    return { model: 'generic', items: [], sheets, workbook };
  });
}

export function parseBIGenericSheet(workbook, { sheetName, mapping, unitFallback, sourceMetadata = {}, dataCutoff = null }) {
  const matrix = worksheetMatrix(workbook, sheetName);
  const header = detectHeader(matrix);
  if (!header) throw new Error('A aba selecionada precisa ter uma linha de cabeçalho identificável com código e descrição.');
  const { index, headers, rawHeaders } = header;
  const col = (value) => value === '' || value == null ? -1 : Number(value);
  const codeAt = mapping?.code ?? headerIndex(headers, [/^(CODIGO|COD|SKU|ITEM|PART NUMBER|REFERENCIA)$/]);
  const descAt = mapping?.description ?? headerIndex(headers, [/^(DESCRICAO|PRODUTO|NOME)$/]);
  const unitAt = col(mapping?.unit);
  const periodAt = col(mapping?.period);
  const quantityAt = col(mapping?.quantity);
  if (codeAt < 0 || descAt < 0) throw new Error('Mapeie uma coluna de código e outra de descrição.');
  const wideMonths = monthHeaders(rawHeaders);
  const buckets = new Map();
  for (const [offset, source] of matrix.slice(index + 1).entries()) {
    const code = cleanCode(source[codeAt]);
    if (!code) continue;
    const unit = safeUnit(source[unitAt], unitFallback);
    if (!unit) throw new Error(`A linha ${index + offset + 2} não tem unidade. Informe uma unidade padrão ou mapeie a coluna.`);
    const key = `${normalizeBIText(unit)}\u0000${code}`;
    if (!buckets.has(key)) buckets.set(key, { company_id: null, unit_name: unit, code, description: String(source[descAt] ?? '').trim() || null, abc_class: null, turn_class: null, historical_value: 0, months_active: null, days_without_purchase: null, stock_available: null, open_orders: null, substitutions: [], historical_months: {}, forecast_months: {}, suggested_quantity: null, net_suggested_quantity: null, prudence_factor: null, eligible_for_suggestion: false, review_reasons: [], trend_percent: null, trend_3m_percent: null, seasonality: {}, source_reference: { workbook_model: 'generic', worksheet: sheetName, rows: [] }, original_recommendation: {} });
    const item = buckets.get(key);
    item.source_reference.rows.push(index + offset + 2);
    for (const field of ['abc', 'turn', 'historicalValue', 'stock', 'openOrders', 'substitution']) {
      const at = col(mapping?.[field]);
      if (at < 0) continue;
      const value = source[at];
      if (field === 'abc') item.abc_class = ['A','B','C'].includes(String(value).trim().toUpperCase()) ? String(value).trim().toUpperCase() : item.abc_class;
      else if (field === 'turn') item.turn_class = String(value ?? '').trim() || item.turn_class;
      else if (field === 'substitution' && String(value ?? '').trim()) item.substitutions.push(String(value).trim());
      else if (field === 'historicalValue') item.historical_value = parseBINumber(value) ?? item.historical_value;
      else if (field === 'stock') item.stock_available = parseBINumber(value);
      else if (field === 'openOrders') item.open_orders = parseBINumber(value);
    }
    if (periodAt >= 0 && quantityAt >= 0) {
      const month = parseBIMonth(source[periodAt]);
      const quantity = parseBINumber(source[quantityAt]);
      if (!month || quantity == null) item.review_reasons.push(`Competência/quantidade inválida na linha ${index + offset + 2}.`);
      else {
        if (Object.hasOwn(item.historical_months, month)) item.review_reasons.push(`Código e competência repetidos em mais de uma linha (${month}); quantidades foram somadas para análise e precisam de revisão.`);
        item.historical_months[month] = (item.historical_months[month] || 0) + quantity;
      }
    }
    for (const monthColumn of wideMonths) {
      const quantity = parseBINumber(source[monthColumn.index]);
      if (quantity == null) continue;
      const isForecast = col(mapping?.forecastStart) >= 0 ? monthColumn.index >= col(mapping.forecastStart) : false;
      (isForecast ? item.forecast_months : item.historical_months)[monthColumn.month] = quantity;
    }
  }
  const items = deriveBIFields([...buckets.values()].map((item) => ({ ...item, months_active: Object.values(item.historical_months).filter((value) => Number(value) > 0).length, suggested_quantity: null })), { sourceModel: 'generic', dataCutoff });
  const errors = validateBIItems(items);
  if (errors.length) throw new Error(errors.slice(0, 8).join(' '));
  return { model: 'generic', items, sheets: getBIWorkbookSheets(workbook), methodology: { source: 'Importação tabular mapeada. Previsão determinística: média móvel ponderada 50%/30%/20% dos três últimos meses consecutivos disponíveis; somente calculada quando o histórico permite validar os três períodos. ABC calculada por valor histórico da unidade, quando ausente. Os valores e critérios fornecidos permanecem vinculados à linha original; não são criados pedidos de compra.' }, source_metadata: sourceMetadata };
}

function sumValues(object = {}) { return Object.values(object || {}).reduce((sum, value) => sum + (Number(value) || 0), 0); }
function priorMonth(month) {
  const [year, monthNumber] = month.split('-').map(Number);
  const date = new Date(Date.UTC(year, monthNumber - 2, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function deriveBIFields(items, { sourceModel = 'generic', dataCutoff = null } = {}) {
  const copy = items.map((source) => ({ ...source, historical_months: { ...(source.historical_months || {}) }, forecast_months: { ...(source.forecast_months || {}) }, review_reasons: [...(source.review_reasons || [])] }));
  const byUnit = new Map();
  for (const item of copy) {
    if (!byUnit.has(item.unit_name)) byUnit.set(item.unit_name, []);
    byUnit.get(item.unit_name).push(item);
    const keys = Object.keys(item.historical_months).sort();
    if (item.months_active == null) item.months_active = keys.filter((key) => Number(item.historical_months[key]) > 0).length;
    if (item.trend_percent == null) {
      const byMonth = (year) => keys.filter((key) => key.startsWith(`${year}-`) && key.slice(5) <= '09').reduce((total, key) => total + Number(item.historical_months[key] || 0), 0);
      const previous = byMonth(2025); const current = byMonth(2026);
      if (previous > 0) item.trend_percent = ((current - previous) / previous) * 100;
      const recentByYear = (year) => keys.filter((key) => key.startsWith(`${year}-`) && Number(key.slice(5)) >= 7 && Number(key.slice(5)) <= 9).reduce((total, key) => total + Number(item.historical_months[key] || 0), 0);
      const previousQuarter = recentByYear(2025); const currentQuarter = recentByYear(2026);
      if (previousQuarter > 0) item.trend_3m_percent = ((currentQuarter - previousQuarter) / previousQuarter) * 100;
    }
    if (!item.seasonality || Object.keys(item.seasonality).length === 0) {
      const monthly = new Map();
      for (const key of keys) {
        const month = key.slice(5, 7);
        const existing = monthly.get(month) || { total: 0, periods: 0 };
        existing.total += Number(item.historical_months[key] || 0); existing.periods += 1; monthly.set(month, existing);
      }
      item.seasonality = Object.fromEntries([...monthly.entries()].sort(([left],[right]) => left.localeCompare(right)).map(([month, values]) => [month, Math.round((values.total / values.periods) * 100) / 100]));
    }
    if (sourceModel === 'generic' && item.review_reasons.length === 0 && item.days_without_purchase != null && item.days_without_purchase >= 180 && !item.eligible_for_suggestion) item.review_reasons.push('Sem movimentação recente: fonte informa 180 dias ou mais sem compra.');
    if (sourceModel === 'generic' && item.review_reasons.length === 0 && item.trend_percent != null && item.trend_percent <= -50) item.review_reasons.push('Queda histórica igual ou superior a 50%; revisar antes de planejar reposição.');
    if (sourceModel === 'generic' && Object.keys(item.forecast_months).length === 0) {
      const usable = keys.filter((month) => !dataCutoff || month < dataCutoff.slice(0, 7) || (month === dataCutoff.slice(0, 7) && new Date(`${dataCutoff}T00:00:00Z`).getUTCDate() >= new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate()));
      const recent = usable.slice(-3);
      if (recent.length === 3 && recent[0] === priorMonth(recent[1]) && recent[1] === priorMonth(recent[2])) {
        const demand = recent.reduce((total, month, index) => total + Number(item.historical_months[month] || 0) * [0.2, 0.3, 0.5][index], 0);
        const lastMonth = recent[2];
        for (let offset = 1; offset <= 4; offset += 1) {
          let month = lastMonth;
          for (let step = 0; step < offset; step += 1) month = (() => { const [year, monthNumber] = month.split('-').map(Number); const date = new Date(Date.UTC(year, monthNumber, 1)); return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`; })();
          item.forecast_months[month] = Math.round(demand * 100) / 100;
        }
        if (demand > 0 && !item.review_reasons.length) {
          item.suggested_quantity = Math.round(demand * 100) / 100;
          item.eligible_for_suggestion = true;
          item.original_recommendation = { status: 'recommended', quantity: item.suggested_quantity, method: 'weighted_moving_average_3_months', weights: [0.2, 0.3, 0.5], source: 'historical_months' };
        }
      } else if (!item.eligible_for_suggestion && item.review_reasons.length === 0) item.review_reasons.push('Histórico insuficiente para previsão: são necessários três meses consecutivos completos.');
    }
  }
  if (sourceModel === 'generic') {
    for (const rows of byUnit.values()) {
      const ranked = [...rows].sort((a, b) => Number(b.historical_value || 0) - Number(a.historical_value || 0));
      const total = ranked.reduce((sum, row) => sum + Math.max(0, Number(row.historical_value || 0)), 0);
      let accumulated = 0;
      for (const row of ranked) {
        const value = Math.max(0, Number(row.historical_value || 0));
        const share = total > 0 ? accumulated / total : 1;
        if (!row.abc_class) row.abc_class = total === 0 ? null : share < 0.8 ? 'A' : share < 0.95 ? 'B' : 'C';
        accumulated += value;
      }
    }
  }
  for (const item of copy) {
    item.net_suggested_quantity = item.stock_available != null && item.open_orders != null && Object.keys(item.forecast_months).length > 0
      ? Math.max(0, Math.round((sumValues(item.forecast_months) - Number(item.stock_available) - Number(item.open_orders)) * 100) / 100)
      : null;
  }
  return copy;
}

function normTurn(value = '') {
  const text = normalizeBIText(value);
  if (text.includes('ALTO')) return 'alto';
  if (text.includes('MEDIO')) return 'medio';
  if (text.includes('BAIXO') || text.includes('NULO')) return 'baixo';
  return 'nao_informado';
}

export function buildBIAnalysis(items = [], decisions = [], { unit = 'Todas', query = '', abc = 'Todos', turn = 'Todos', status = 'Todos' } = {}) {
  const filtered = items.filter((item) => (unit === 'Todas' || item.unit_name === unit)
    && (!query || `${item.code} ${item.description || ''}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()))
    && (abc === 'Todos' || item.abc_class === abc)
    && (turn === 'Todos' || normTurn(item.turn_class) === turn.toLowerCase())
    && (status === 'Todos' || (status === 'Sugestão' ? item.eligible_for_suggestion : status === 'Revisão' ? item.review_reasons?.length > 0 : !item.eligible_for_suggestion && !item.review_reasons?.length)));
  const decisionByItem = new Map();
  for (const decision of [...decisions].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())) if (!decisionByItem.has(decision.item_id)) decisionByItem.set(decision.item_id, decision);
  const countDistinct = (rows) => new Set(rows.map((row) => row.code)).size;
  const byUnit = [...new Set(items.map((row) => row.unit_name))].sort().map((unitName) => {
    const rows = items.filter((row) => row.unit_name === unitName);
    const forecastMonths = [...new Set(rows.flatMap((row) => Object.keys(row.forecast_months || {})))].sort();
    const abcs = { A: 0, B: 0, C: 0 };
    for (const row of rows) if (row.abc_class in abcs) abcs[row.abc_class] += 1;
    const turns = { alto: 0, medio: 0, baixo: 0, nao_informado: 0 };
    for (const row of rows) turns[normTurn(row.turn_class)] += 1;
    return { unit: unitName, itemCount: countDistinct(rows), rows: rows.length, abcs, turns,
      suggested: rows.filter((row) => row.eligible_for_suggestion).length,
      review: rows.filter((row) => row.review_reasons?.length).length,
      blocked: rows.filter((row) => !row.eligible_for_suggestion && !row.review_reasons?.length).length,
      historicalValue: rows.reduce((sum, row) => sum + Number(row.historical_value || 0), 0),
      historicalQuantity: rows.reduce((sum, row) => sum + sumValues(row.historical_months), 0),
      suggestedQuantity: rows.reduce((sum, row) => sum + Number(row.suggested_quantity || 0), 0),
      forecast: forecastMonths.map((month) => ({ month, codes: new Set(rows.filter((row) => Number(row.forecast_months?.[month] || 0) > 0).map((row) => row.code)).size, quantity: rows.reduce((sum, row) => sum + Number(row.forecast_months?.[month] || 0), 0) })),
    };
  });
  const selectedItemCodes = countDistinct(filtered);
  const monthKeys = [...new Set(filtered.flatMap((row) => Object.keys(row.historical_months || {})))].sort();
  const forecastKeys = [...new Set(filtered.flatMap((row) => Object.keys(row.forecast_months || {})))].sort();
  const monthlyHistory = monthKeys.map((month) => ({ month, codes: new Set(filtered.filter((row) => Number(row.historical_months?.[month] || 0) > 0).map((row) => row.code)).size, quantity: filtered.reduce((sum, row) => sum + Number(row.historical_months?.[month] || 0), 0) }));
  const forecast = forecastKeys.map((month) => ({ month, codes: new Set(filtered.filter((row) => Number(row.forecast_months?.[month] || 0) > 0).map((row) => row.code)).size, quantity: filtered.reduce((sum, row) => sum + Number(row.forecast_months?.[month] || 0), 0) }));
  const abcCounts = { A: 0, B: 0, C: 0 };
  for (const row of filtered) if (row.abc_class in abcCounts) abcCounts[row.abc_class] += 1;
  const turnSummary = { alto: 0, medio: 0, baixo: 0, nao_informado: 0 };
  for (const row of filtered) turnSummary[normTurn(row.turn_class)] += 1;
  return {
    filtered, decisionByItem, byUnit,
    totals: { distinctCodes: selectedItemCodes, rows: filtered.length, abc: abcCounts, turns: turnSummary,
      suggested: filtered.filter((row) => row.eligible_for_suggestion).length,
      review: filtered.filter((row) => row.review_reasons?.length).length,
      blocked: filtered.filter((row) => !row.eligible_for_suggestion && !row.review_reasons?.length).length,
      historicalValue: filtered.reduce((sum, row) => sum + Number(row.historical_value || 0), 0),
      historicalQuantity: filtered.reduce((sum, row) => sum + sumValues(row.historical_months), 0),
      suggestedQuantity: filtered.reduce((sum, row) => sum + Number(row.suggested_quantity || 0), 0),
      approved: filtered.filter((row) => ['approved','adjusted'].includes(decisionByItem.get(row.id)?.status)).length,
    },
    monthlyHistory, forecast,
  };
}

export async function hashBIFile(file) {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
