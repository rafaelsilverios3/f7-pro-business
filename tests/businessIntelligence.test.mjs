import test from 'node:test';
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import { buildBIAnalysis, deriveBIFields, getBIWorkbookSheets, parseBIMonth, parseBIGenericSheet, parseBINumber, validateBIItems } from '../src/lib/businessIntelligence.js';

test('preserves identifiers and parses localized numbers and month labels', () => {
  assert.equal(parseBINumber('R$ 1.234,56'), 1234.56);
  assert.equal(parseBINumber('1,234.56'), 1234.56);
  assert.equal(parseBIMonth('Nov/26'), '2026-11');
  assert.equal(parseBIMonth('01/25'), '2025-01');
});

test('generic workbook maps identifiers as text, separates units and flags repeated code-month rows', () => {
  const workbook = XLSX.utils.book_new();
  const source = [
    ['Código', 'Descrição', 'Unidade', 'Competência', 'Quantidade', 'Valor histórico', 'Estoque', 'Pedidos abertos'],
    ['000042', 'Peça Alfa', 'Angélica', '01/26', '10', 'R$ 500,00', '3', '2'],
    ['000042', 'Peça Alfa', 'Angélica', '02/26', '20', 'R$ 500,00', '3', '2'],
    ['000042', 'Peça Alfa', 'Angélica', '03/26', '30', 'R$ 500,00', '3', '2'],
    ['000042', 'Peça Alfa', 'Ivinhema', '03/26', '4', 'R$ 200,00', '1', '0'],
    ['000042', 'Peça Alfa', 'Angélica', '03/26', '2', 'R$ 500,00', '3', '2'],
  ];
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(source), 'Consumo');
  const sheet = getBIWorkbookSheets(workbook)[0];
  const index = (name) => sheet.headers.findIndex((header) => header === name);
  const parsed = parseBIGenericSheet(workbook, { sheetName: 'Consumo', mapping: { code: index('Código'), description: index('Descrição'), unit: index('Unidade'), period: index('Competência'), quantity: index('Quantidade'), historicalValue: index('Valor histórico'), stock: index('Estoque'), openOrders: index('Pedidos abertos') } });
  assert.equal(parsed.items.length, 2);
  const angelica = parsed.items.find((item) => item.unit_name === 'Angélica');
  assert.equal(angelica.code, '000042');
  assert.equal(angelica.historical_months['2026-03'], 32);
  assert.equal(angelica.stock_available, 3);
  assert.ok(angelica.review_reasons.some((reason) => reason.includes('repetidos')));
  assert.equal(parsed.items.find((item) => item.unit_name === 'Ivinhema').historical_months['2026-03'], 4);
  assert.equal(validateBIItems(parsed.items).length, 0);
});

test('validates invalid and negative source values before importing', () => {
  const errors = validateBIItems([{ code: 'A1', unit_name: 'Unidade A', historical_months: { '2026-01': -1 }, forecast_months: {}, stock_available: -2 }]);
  assert.ok(errors.some((message) => message.includes('negativa')));
  assert.ok(errors.some((message) => message.includes('estoque negativo')));
});

test('weighted forecasts require three consecutive historical months and source ABC stays untouched', () => {
  const [item] = deriveBIFields([{ code: '01', unit_name: 'A', abc_class: 'C', historical_value: 500, historical_months: { '2026-01': 10, '2026-02': 20, '2026-03': 30 }, forecast_months: {}, review_reasons: [], eligible_for_suggestion: false }]);
  assert.equal(item.abc_class, 'C');
  assert.equal(item.forecast_months['2026-04'], 23);
  assert.equal(item.forecast_months['2026-07'], 23);
  assert.equal(item.suggested_quantity, 23);
  const [incomplete] = deriveBIFields([{ code: '02', unit_name: 'A', historical_months: { '2026-01': 5, '2026-03': 7 }, forecast_months: {}, review_reasons: [], eligible_for_suggestion: false }]);
  assert.equal(Object.keys(incomplete.forecast_months).length, 0);
  assert.equal(incomplete.eligible_for_suggestion, false);
});

test('dashboard metrics count distinct product codes per unit and filter the selected unit', () => {
  const items = [
    { id: '1', code: '0001', unit_name: 'A', abc_class: 'A', turn_class: 'Alto', historical_months: { '2026-01': 1 }, forecast_months: { '2026-02': 2 }, eligible_for_suggestion: true, review_reasons: [], historical_value: 100, suggested_quantity: 2 },
    { id: '2', code: '0001', unit_name: 'B', abc_class: 'B', turn_class: 'Médio', historical_months: { '2026-01': 1 }, forecast_months: { '2026-02': 3 }, eligible_for_suggestion: false, review_reasons: ['Revisar'], historical_value: 50, suggested_quantity: null },
  ];
  const all = buildBIAnalysis(items);
  assert.equal(all.totals.distinctCodes, 1);
  assert.equal(all.byUnit.find((unit) => unit.unit === 'A').itemCount, 1);
  assert.equal(all.byUnit.find((unit) => unit.unit === 'B').itemCount, 1);
  assert.equal(all.forecast[0].codes, 1);
  assert.equal(all.forecast[0].quantity, 5);
  assert.equal(buildBIAnalysis(items, [], { unit: 'B' }).totals.distinctCodes, 1);
});
