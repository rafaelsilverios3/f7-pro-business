import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import * as XLSX from 'xlsx';
import { parseCampaignWorkbookBuffer } from '../src/lib/campaignWorkbookParser.js';
import { assertCampaignResumeWorkbookMatches, validateCampaignWorkbookDimensions, validateCampaignWorkbookInput } from '../src/lib/campaignWorkbookGuards.js';
import { parseCampaignWorkbookInWorker } from '../src/services/campaignWorkbookWorker.js';

const allSheets = {
  'Plano de Acao': [
    ['Prioridade', 'Cliente', 'Código', 'Produto', 'FY2025', 'FY2026', 'Variação R$', 'Oportunidade R$', 'Variação %'],
    ['P1 - ALTA', 'Cliente A', 'SKU-1', 'Produto A', 100.25, 50.25, -50, 50, -0.4987531172],
  ],
  'Cliente x Item': [
    ['Cliente', 'Código', 'Descrição', 'FY2025', 'FY2026', 'Variação R$', 'Variação %', 'Status'],
    ['Cliente A', 'SKU-1', 'Produto A', 100.25, 50.25, -50, -0.4987531172, 'Ativo'],
  ],
  Clientes: [['Cliente'], ['Cliente A']],
  Itens: [['Descrição', 'Código'], ['Produto A', 'SKU-1']],
  'Gestao Campanha': [
    ['OPORTUNIDADES MAPEADAS', 1], ['VALOR TOTAL DE OPORTUNIDADE', 50],
    ['PRIORIDADE P1', 1], ['PRIORIDADE P2', 0], ['PRIORIDADE P3', 0],
  ],
};

function createWorkbook(sheets = allSheets, bookType = 'xlsx') {
  const workbook = XLSX.utils.book_new();
  for (const [name, rows] of Object.entries(sheets)) XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), name);
  return XLSX.write(workbook, { type: 'array', bookType });
}

function fileFor(buffer, name = 'campanha.xlsx') {
  return { name, size: buffer.byteLength, arrayBuffer: async () => buffer.slice(0) };
}

function findEndOfCentralDirectory(bytes) {
  for (let offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 65557); offset -= 1) {
    if (bytes[offset] === 0x50 && bytes[offset + 1] === 0x4b && bytes[offset + 2] === 0x05 && bytes[offset + 3] === 0x06) return offset;
  }
  throw new Error('EOCD não localizado');
}

test('planilha válida preserva as cinco abas, números, matching de origem, origem de linha e hash SHA-256', async () => {
  const buffer = createWorkbook();
  const parsed = await parseCampaignWorkbookBuffer(buffer, 'campanha.xlsx');
  assert.equal(parsed.actionRows[0].sheet, 'Plano de Acao');
  assert.equal(parsed.actionRows[0].sourceRow, 2);
  assert.equal(parsed.actionRows[0].priority, 'P1 - ALTA');
  assert.equal(parsed.actionRows[0].baseValue, 100.25);
  assert.equal(parsed.actionRows[0].sourceDifference, -50);
  assert.equal(parsed.historyRows[0].sheet, 'Cliente x Item');
  assert.equal(parsed.historyRows[0].sourceRow, 2);
  assert.equal(parsed.historyRows[0].sourceStatus, 'Ativo');
  assert.deepEqual(parsed.customerRows, [{ name: 'Cliente A' }]);
  assert.deepEqual(parsed.productRows, [{ name: 'Produto A', sku: 'SKU-1' }]);
  assert.deepEqual(parsed.managementSummary, { opportunities: 1, potential: 50, p1: 1, p2: null, p3: null });
  assert.match(parsed.sourceFileHash, /^[a-f0-9]{64}$/);
  assert.equal(parsed.sourceFileName, 'campanha.xlsx');
});

test('planilha XLS binária legada continua compatível', async () => {
  const parsed = await parseCampaignWorkbookBuffer(createWorkbook(allSheets, 'biff8'), 'campanha.xls');
  assert.equal(parsed.actionRows.length, 1);
  assert.equal(parsed.historyRows[0].customer, 'Cliente A');
  assert.equal(parsed.sourceFileName, 'campanha.xls');
});

test('planilha sem dados, bytes vazios, formato inválido e aba de ação ausente são rejeitados', async () => {
  assert.throws(() => validateCampaignWorkbookInput(new ArrayBuffer(0), 'vazia.xlsx'), /vazio/i);
  assert.throws(() => validateCampaignWorkbookInput(new Uint8Array([1, 2, 3]).buffer, 'arquivo.xlsx'), /formato/i);
  const empty = createWorkbook({ 'Plano de Acao': [['Prioridade', 'Cliente', 'Código', 'Produto']] });
  await assert.rejects(parseCampaignWorkbookBuffer(empty, 'vazia.xlsx'), /não contém registros/i);
  const missing = createWorkbook({ Clientes: [['Cliente'], ['A']] });
  await assert.rejects(parseCampaignWorkbookBuffer(missing, 'sem-plano.xlsx'), /aba Plano de Acao/i);
});

test('limite de bytes e ZIP com expansão adversarial são recusados antes do parser', () => {
  assert.throws(() => validateCampaignWorkbookInput(new ArrayBuffer(15 * 1024 * 1024 + 1), 'grande.xlsx'), /15 MiB/i);
  const bytes = new Uint8Array(createWorkbook());
  const eocd = findEndOfCentralDirectory(bytes);
  const centralOffset = new DataView(bytes.buffer).getUint32(eocd + 16, true);
  new DataView(bytes.buffer).setUint32(centralOffset + 24, 32 * 1024 * 1024 + 1, true);
  assert.throws(() => validateCampaignWorkbookInput(bytes.buffer, 'zip-bomb.xlsx'), /32 MiB/i);
});

test('abas acima dos limites de linhas e colunas são rejeitadas com instrução clara', async () => {
  const actionRows = [['Cliente', 'Código', 'Produto'], ...Array.from({ length: 50001 }, (_, index) => [`Cliente ${index}`, `SKU-${index}`, 'Produto'])];
  await assert.rejects(parseCampaignWorkbookBuffer(createWorkbook({ 'Plano de Acao': actionRows }), 'linhas.xlsx'), /50\.000 linhas/i);
  const wide = createWorkbook({ 'Plano de Acao': [['Cliente', 'Código', ...Array.from({ length: 99 }, (_, index) => `Campo ${index}`)], ['A', '1']] });
  await assert.rejects(parseCampaignWorkbookBuffer(wide, 'colunas.xlsx'), /100 colunas/i);
});

test('limites cumulativos rejeitam excesso de células e de linhas antes da conversão JSON', () => {
  assert.throws(() => validateCampaignWorkbookDimensions([
    { name: 'A', rows: 8001, columns: 95, maxDataRows: 10000 },
    { name: 'B', rows: 8001, columns: 95, maxDataRows: 10000 },
  ]), /1\.500\.000 células/i);
  assert.throws(() => validateCampaignWorkbookDimensions([
    { name: 'A', rows: 45000, columns: 1, maxDataRows: 50000 },
    { name: 'B', rows: 45000, columns: 1, maxDataRows: 50000 },
    { name: 'C', rows: 45000, columns: 1, maxDataRows: 50000 },
  ]), /130\.005 linhas/i);
});

test('estrutura malformada e conteúdo de célula fora do formato esperado são rejeitados', async () => {
  const invalidHeader = createWorkbook({ 'Plano de Acao': [['Prioridade', 'Conta', 'Material'], ['P1', 'A', 'B']] });
  await assert.rejects(parseCampaignWorkbookBuffer(invalidHeader, 'malformada.xlsx'), /coluna Cliente/i);
  const badNumber = createWorkbook({ 'Plano de Acao': [['Cliente', 'Código', 'FY2025'], ['Cliente', 'SKU', 'não é número']] });
  await assert.rejects(parseCampaignWorkbookBuffer(badNumber, 'numero-invalido.xlsx'), /valor numérico inválido/i);
  const formulaBook = XLSX.utils.book_new();
  const formulaSheet = XLSX.utils.aoa_to_sheet([['Cliente', 'Código', 'FY2025'], ['Cliente A', 'SKU-1', null]]);
  formulaSheet.C2 = { t: 'n', f: '1+1' };
  XLSX.utils.book_append_sheet(formulaBook, formulaSheet, 'Plano de Acao');
  const formulaBuffer = XLSX.write(formulaBook, { type: 'array', bookType: 'xlsx' });
  await assert.rejects(parseCampaignWorkbookBuffer(formulaBuffer, 'formula-sem-resultado.xlsx'), /fórmula/i);
});

test('retomada parcial só aceita o mesmo nome e hash integral do batch', () => {
  const workbook = { sourceFileName: 'campanha.xlsx', sourceFileHash: 'a'.repeat(64) };
  const record = { file_name: workbook.sourceFileName, file_hash: workbook.sourceFileHash };
  assert.doesNotThrow(() => assertCampaignResumeWorkbookMatches(workbook, record));
  assert.throws(() => assertCampaignResumeWorkbookMatches({ ...workbook, sourceFileHash: 'b'.repeat(64) }, record), /não corresponde/i);
});

class FakeWorker {
  listeners = new Map();
  terminated = false;

  addEventListener(type, listener) { this.listeners.set(type, listener); }
  removeEventListener(type) { this.listeners.delete(type); }
  terminate() { this.terminated = true; }
  postMessage(message) {
    this.message = message;
    if (this.reply) setTimeout(() => this.listeners.get('message')?.({ data: { id: message.id, ok: true, workbook: { sourceFileHash: 'c'.repeat(64) } } }), 0);
  }
}

test('prévia transfere um único buffer ao Worker e interrupção termina a análise sem resultado tardio', async () => {
  const buffer = createWorkbook();
  const file = fileFor(buffer);
  let reads = 0;
  file.arrayBuffer = async () => { reads += 1; return buffer.slice(0); };
  const worker = new FakeWorker();
  worker.reply = true;
  const parsed = await parseCampaignWorkbookInWorker(file, { workerFactory: () => worker });
  assert.equal(parsed.sourceFileHash, 'c'.repeat(64));
  assert.equal(reads, 1);
  assert.equal(worker.terminated, true);
  assert.ok(worker.message.buffer instanceof ArrayBuffer);

  const controller = new AbortController();
  const interruptedWorker = new FakeWorker();
  const pending = parseCampaignWorkbookInWorker(fileFor(buffer), { signal: controller.signal, workerFactory: () => interruptedWorker });
  await new Promise((resolve) => setTimeout(resolve, 0));
  controller.abort();
  await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(interruptedWorker.terminated, true);
});

test('Vite pode identificar estaticamente o Worker e a página não carrega o parser XLSX na thread principal', () => {
  const workerService = fs.readFileSync(new URL('../src/services/campaignWorkbookWorker.js', import.meta.url), 'utf8');
  const campaignService = fs.readFileSync(new URL('../src/services/commercialCampaignService.js', import.meta.url), 'utf8');
  assert.match(workerService, /new Worker\(new URL\('\.\.\/workers\/campaignWorkbook\.worker\.js', import\.meta\.url\), \{ type: 'module' \}\)/);
  assert.doesNotMatch(campaignService, /from ['"]xlsx['"]|import\(['"]xlsx['"]\)/);
});
