import * as XLSX from 'xlsx';
import { normalizeCampaignText, toFiniteNumber } from './commercialCampaign.js';
import { CAMPAIGN_WORKBOOK_LIMITS, validateCampaignWorkbookDimensions, validateCampaignWorkbookInput } from './campaignWorkbookGuards.js';

const actionHeaders = {
  priority: ['prioridade', 'priority'],
  customer: ['cliente', 'customer'],
  code: ['codigo', 'sku', 'part number'],
  product: ['produto', 'descricao', 'item'],
  baseValue: ['fy2025', 'base', 'ano base'],
  compareValue: ['fy2026', 'compare', 'ano comparado'],
  sourceDifference: ['variacao r$', 'diferenca r$'],
  sourcePotential: ['oportunidade r$', 'potencial r$', 'potential'],
  sourceVariationPct: ['variacao %', 'percentual', 'queda %'],
};

const sheetNames = Object.freeze({
  action: ['Plano de Acao', 'Plano de Ação'],
  history: 'Cliente x Item',
  customers: 'Clientes',
  products: 'Itens',
  management: 'Gestao Campanha',
});

const aliases = {
  history: {
    customer: ['cliente'], code: ['codigo', 'sku', 'part number'], product: ['descricao', 'produto', 'item'],
    baseValue: ['fy2025'], compareValue: ['fy2026'], sourceDifference: ['variacao r$', 'diferenca r$'],
    sourceVariationPct: ['variacao %'], sourceStatus: ['status'],
  },
  customers: { name: ['cliente'] },
  products: { name: ['descricao', 'produto', 'item'], sku: ['codigo', 'sku', 'part number'] },
};

function fail(message) { throw new Error(message); }

function normalizeHeader(value) {
  return String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

function resolveSheet(workbook, name) {
  const actualName = workbook.SheetNames.find((candidate) => candidate.toLocaleLowerCase('pt-BR') === name.toLocaleLowerCase('pt-BR'));
  return actualName ? workbook.Sheets[actualName] : null;
}

function worksheetRows(sheet, maxDataRows = 50000) {
  if (!sheet) return null;
  const ref = sheet['!fullref'] || sheet['!ref'];
  if (typeof ref !== 'string') return null;
  const range = XLSX.utils.decode_range(ref);
  const rows = range.e.r - range.s.r + 1;
  const columns = range.e.c - range.s.c + 1;
  return { range, rows, columns, maxDataRows };
}

function validateWorksheetValues(sheet, name, dataRows) {
  const maxText = CAMPAIGN_WORKBOOK_LIMITS.maxTextLength;
  for (const [address, cell] of Object.entries(sheet || {})) {
    if (address.startsWith('!') || !cell || typeof cell !== 'object') continue;
    if (cell.t === 'e') fail(`A aba “${name}” contém erro de fórmula na célula ${address}. Corrija a planilha antes de importar.`);
    if (cell.f && cell.v == null) fail(`A aba “${name}” contém uma fórmula sem resultado na célula ${address}. Abra a planilha no Excel, recalcule e salve antes de importar.`);
  }
  for (const row of dataRows) {
    for (const value of row) {
      if (value == null) continue;
      if (value instanceof Date) {
        if (Number.isNaN(value.getTime())) fail(`A aba “${name}” contém uma data inválida.`);
      } else if (typeof value === 'number') {
        if (!Number.isFinite(value)) fail(`A aba “${name}” contém um número inválido.`);
      } else if (typeof value === 'string') {
        if (value.length > maxText) fail(`A aba “${name}” contém texto acima do limite de 2.000 caracteres.`);
        if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) fail(`A aba “${name}” contém caracteres de controle inválidos.`);
      } else if (typeof value !== 'boolean') {
        fail(`A aba “${name}” contém um tipo de dado inesperado.`);
      }
    }
  }
}

function toJsonScalar(value) {
  return value instanceof Date ? value.toISOString() : value;
}

function validateNumericValues(rows, fields, sheetName) {
  for (const row of rows) {
    for (const field of fields) {
      const value = row[field];
      if (value == null || value === '') continue;
      if (toFiniteNumber(value) === null) fail(`A aba “${sheetName}” contém um valor numérico inválido na coluna ${field}.`);
    }
  }
}

function valuesByHeaders(grid, mapping, sheetName, requiredFields, alternatives = [], firstRowOffset = 0) {
  if (!grid.length) return [];
  const headers = grid[0].map(normalizeHeader);
  for (const field of requiredFields) {
    const fieldAliases = mapping[field];
    if (!headers.some((header) => fieldAliases.includes(header))) fail(`A aba “${sheetName}” não contém a coluna obrigatória “${fieldAliases[0]}”.`);
  }
  if (alternatives.length && !alternatives.some((field) => headers.some((header) => mapping[field].includes(header)))) fail(`A aba “${sheetName}” precisa conter a coluna “${alternatives.map((field) => mapping[field][0]).join('” ou “')}”.`);
  const indexes = Object.fromEntries(Object.entries(mapping).map(([field, fieldAliases]) => [field, headers.findIndex((header) => fieldAliases.includes(header))]));
  return grid.slice(1).map((row, index) => ({ row, sourceRow: firstRowOffset + index + 2, indexes }));
}

export async function parseCampaignWorkbookBuffer(buffer, fileName) {
  validateCampaignWorkbookInput(buffer, fileName);
  if (!globalThis.crypto?.subtle) fail('Não foi possível calcular o hash seguro da planilha. Abra o sistema em uma conexão HTTPS e tente novamente.');
  const digest = await globalThis.crypto.subtle.digest('SHA-256', buffer);
  const sourceFileHash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
  let workbook;
  try {
    workbook = XLSX.read(buffer, { type: 'array', cellDates: true, sheetRows: CAMPAIGN_WORKBOOK_LIMITS.maxWorksheetRows });
  } catch {
    fail('Não foi possível abrir a planilha. O arquivo está malformado ou usa um formato não suportado.');
  }
  if (!Array.isArray(workbook.SheetNames) || !workbook.SheetNames.length || workbook.SheetNames.length > CAMPAIGN_WORKBOOK_LIMITS.maxWorksheets) {
    fail('A planilha precisa conter de 1 a 16 abas.');
  }
  const selectedSheets = [
    ['action', resolveSheet(workbook, sheetNames.action[0]) || resolveSheet(workbook, sheetNames.action[1])],
    ['history', resolveSheet(workbook, sheetNames.history)],
    ['customers', resolveSheet(workbook, sheetNames.customers)],
    ['products', resolveSheet(workbook, sheetNames.products)],
    ['management', resolveSheet(workbook, sheetNames.management)],
  ];
  if (!selectedSheets[0][1]) fail('A planilha precisa conter a aba Plano de Acao.');
  const dimensions = [];
  const knownSheetByName = new Map(selectedSheets.filter(([, sheet]) => sheet).map(([key, sheet]) => [sheet, key]));
  const grids = Object.fromEntries(selectedSheets.map(([key]) => [key, []]));
  const firstRowOffsets = {};
  for (const actualName of workbook.SheetNames) {
    const sheet = workbook.Sheets[actualName];
    const key = knownSheetByName.get(sheet);
    const name = key === 'action' ? 'Plano de Acao' : key ? sheetNames[key] : actualName;
    const maxRows = key === 'customers' || key === 'products' ? 10000 : key === 'management' ? 100 : 50000;
    const result = worksheetRows(sheet, maxRows);
    if (!result) continue;
    dimensions.push({ name, rows: result.rows, columns: result.columns, maxDataRows: result.maxDataRows });
    validateCampaignWorkbookDimensions(dimensions);
    if (key) {
      const grid = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, raw: true, blankrows: true });
      validateWorksheetValues(sheet, name, grid);
      grids[key] = grid;
      firstRowOffsets[key] = result.range.s.r;
    }
  }

  const actionGrid = grids.action;
  const actionHeaderKeys = actionGrid[0]?.map(normalizeHeader) || [];
  for (const required of ['customer']) {
    if (!actionHeaderKeys.some((header) => actionHeaders[required].includes(header))) fail('A aba “Plano de Acao” precisa conter uma coluna Cliente.');
  }
  if (!['code', 'product'].some((field) => actionHeaderKeys.some((header) => actionHeaders[field].includes(header)))) {
    fail('A aba “Plano de Acao” precisa conter uma coluna Código/SKU ou Produto/Descrição.');
  }
  const actionRows = actionGrid.slice(1).map((row, index) => {
    const get = (field) => {
      const at = actionHeaderKeys.findIndex((header) => actionHeaders[field].includes(header));
      return at < 0 ? null : toJsonScalar(row[at]);
    };
    return {
      sheet: 'Plano de Acao', sourceRow: (firstRowOffsets.action || 0) + index + 2,
      priority: get('priority'), customer: get('customer'), code: get('code'), product: get('product'),
      baseValue: get('baseValue'), compareValue: get('compareValue'), sourceDifference: get('sourceDifference'),
      sourcePotential: get('sourcePotential'), sourceVariationPct: get('sourceVariationPct'),
    };
  }).filter((row) => row.customer || row.code || row.product);
  if (actionRows.length > 50000) fail('A aba “Plano de Acao” excede o limite de 50.000 registros.');
  validateNumericValues(actionRows, ['baseValue', 'compareValue', 'sourceDifference', 'sourcePotential', 'sourceVariationPct'], 'Plano de Acao');

  const historyData = grids.history.length ? valuesByHeaders(grids.history, aliases.history, sheetNames.history, ['customer'], ['code', 'product'], firstRowOffsets.history || 0) : [];
  const historyRows = historyData.map(({ row, sourceRow, indexes }) => ({
    sheet: 'Cliente x Item', sourceRow,
    customer: toJsonScalar(row[indexes.customer]), code: toJsonScalar(row[indexes.code]), product: toJsonScalar(row[indexes.product]),
    baseValue: toJsonScalar(row[indexes.baseValue]), compareValue: toJsonScalar(row[indexes.compareValue]),
    sourceDifference: toJsonScalar(row[indexes.sourceDifference]), sourceVariationPct: toJsonScalar(row[indexes.sourceVariationPct]),
    sourceStatus: toJsonScalar(row[indexes.sourceStatus]),
  })).filter((row) => row.customer || row.code || row.product);
  if (historyRows.length > 50000) fail('A aba “Cliente x Item” excede o limite de 50.000 registros.');
  validateNumericValues(historyRows, ['baseValue', 'compareValue', 'sourceDifference', 'sourceVariationPct'], 'Cliente x Item');

  const customerData = grids.customers.length ? valuesByHeaders(grids.customers, aliases.customers, sheetNames.customers, ['name']) : [];
  const customerRows = customerData.map(({ row, indexes }) => ({ name: String(row[indexes.name] ?? '').trim() })).filter((row) => row.name);
  if (customerRows.length > 10000) fail('A aba “Clientes” excede o limite de 10.000 registros.');

  const productData = grids.products.length ? valuesByHeaders(grids.products, aliases.products, sheetNames.products, [], ['name', 'sku']) : [];
  const productRows = productData.map(({ row, indexes }) => ({
    name: String(row[indexes.name] ?? '').trim(),
    sku: row[indexes.sku] == null ? null : String(row[indexes.sku]).trim(),
  })).filter((row) => row.name || row.sku);
  if (productRows.length > 10000) fail('A aba “Itens” excede o limite de 10.000 registros.');

  let managementSummary = {};
  if (grids.management.length) {
    const managementGrid = grids.management;
    if (managementGrid.some((row) => !Array.isArray(row) || row.length > 2)) fail('A aba “Gestao Campanha” deve conter no máximo duas colunas.');
    const management = Object.fromEntries(managementGrid.map((row) => [normalizeCampaignText(row?.[0]), toJsonScalar(row?.[1])]));
    const metric = (key) => {
      const value = management[key];
      if (value == null || value === '') return null;
      const number = typeof value === 'number' ? value : Number(String(value).trim().replace(/\./g, '').replace(',', '.'));
      if (!Number.isFinite(number) || number < 0) fail(`A aba “Gestao Campanha” contém um valor inválido para “${key}”.`);
      return number || null;
    };
    managementSummary = {
      opportunities: metric('OPORTUNIDADES MAPEADAS'), potential: metric('VALOR TOTAL DE OPORTUNIDADE'),
      p1: metric('PRIORIDADE P1'), p2: metric('PRIORIDADE P2'), p3: metric('PRIORIDADE P3'),
    };
  }

  if (!actionRows.length && !historyRows.length && !customerRows.length && !productRows.length) {
    fail('A planilha não contém registros para importar. Confira as abas e tente novamente.');
  }

  return {
    actionRows, historyRows, customerRows, productRows, managementSummary,
    sourceFileName: fileName, sourceFileHash,
    sourceFileSize: buffer.byteLength,
  };
}
