export const CAMPAIGN_WORKBOOK_LIMITS = Object.freeze({
  maxFileBytes: 15 * 1024 * 1024,
  maxZipEntries: 512,
  maxZipEntryBytes: 32 * 1024 * 1024,
  maxZipUncompressedBytes: 96 * 1024 * 1024,
  maxCompressionRatio: 200,
  maxWorksheets: 16,
  maxWorksheetRows: 50001,
  maxWorksheetColumns: 100,
  maxTotalRows: 130005,
  maxTotalCells: 1_500_000,
  maxTextLength: 2000,
  maxFilenameLength: 255,
});

function fail(message) {
  throw new Error(message);
}

export function validateCampaignWorkbookInput(buffer, name) {
  if (typeof name !== 'string' || !name.trim() || name.length > CAMPAIGN_WORKBOOK_LIMITS.maxFilenameLength || /[\u0000-\u001f]/.test(name)) {
    fail('Nome de arquivo inválido ou acima do limite de 255 caracteres.');
  }
  if (!/\.(xlsx|xls)$/i.test(name)) fail('Selecione uma planilha .xlsx ou .xls.');
  if (!(buffer instanceof ArrayBuffer) || buffer.byteLength === 0) fail('O arquivo está vazio ou não pôde ser lido.');
  const limits = CAMPAIGN_WORKBOOK_LIMITS;
  if (buffer.byteLength > limits.maxFileBytes) fail('A planilha excede o limite de 15 MiB. Se necessário, divida o arquivo em campanhas menores.');
  const bytes = new Uint8Array(buffer);
  const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b;
  const isOle = bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0;
  if (!isZip && !isOle) fail('Formato de planilha inválido. Salve o arquivo como .xlsx ou .xls e tente novamente.');
  if (isZip) validateZipArchive(bytes);
  return true;
}

export function assertCampaignResumeWorkbookMatches(workbook, importRecord) {
  if (workbook?.sourceFileHash !== importRecord?.file_hash || workbook?.sourceFileName !== importRecord?.file_name) {
    throw new Error('O arquivo selecionado não corresponde ao batch parcial registrado.');
  }
}

export function validateCampaignWorkbookDimensions(sheets) {
  let totalRows = 0;
  let totalCells = 0;
  for (const { name, rows, columns, maxDataRows = 50000 } of sheets) {
    if (rows > Math.min(CAMPAIGN_WORKBOOK_LIMITS.maxWorksheetRows, maxDataRows + 1)) {
      throw new Error(`A aba “${name}” excede o limite de ${maxDataRows.toLocaleString('pt-BR')} linhas de dados.`);
    }
    if (columns > CAMPAIGN_WORKBOOK_LIMITS.maxWorksheetColumns) throw new Error(`A aba “${name}” excede 100 colunas.`);
    totalRows += rows;
    totalCells += rows * columns;
    if (totalRows > CAMPAIGN_WORKBOOK_LIMITS.maxTotalRows) throw new Error('A planilha excede o limite total de 130.005 linhas. Divida o arquivo e tente novamente.');
    if (totalCells > CAMPAIGN_WORKBOOK_LIMITS.maxTotalCells) throw new Error('A planilha excede o limite total de 1.500.000 células. Remova linhas/colunas vazias formatadas e tente novamente.');
  }
  return true;
}

function validateZipArchive(bytes) {
  const limits = CAMPAIGN_WORKBOOK_LIMITS;
  const lowerBound = Math.max(0, bytes.length - 65557);
  let eocd = -1;
  for (let offset = bytes.length - 22; offset >= lowerBound; offset -= 1) {
    if (readU32(bytes, offset) === 0x06054b50) { eocd = offset; break; }
  }
  if (eocd < 0 || eocd + 22 > bytes.length) fail('O arquivo XLSX está incompleto ou possui um índice ZIP inválido.');
  const disk = readU16(bytes, eocd + 4);
  const centralDisk = readU16(bytes, eocd + 6);
  const diskEntries = readU16(bytes, eocd + 8);
  const entryCount = readU16(bytes, eocd + 10);
  const centralSize = readU32(bytes, eocd + 12);
  const centralOffset = readU32(bytes, eocd + 16);
  const commentLength = readU16(bytes, eocd + 20);
  if (disk || centralDisk || diskEntries !== entryCount || eocd + 22 + commentLength !== bytes.length) fail('O arquivo XLSX usa uma estrutura ZIP não suportada.');
  if (!entryCount || entryCount > limits.maxZipEntries || centralOffset + centralSize > eocd) fail('O arquivo XLSX contém quantidade ou índice de componentes fora do limite.');
  let cursor = centralOffset;
  let totalUncompressed = 0;
  for (let index = 0; index < entryCount; index += 1) {
    if (cursor + 46 > eocd || readU32(bytes, cursor) !== 0x02014b50) fail('O índice interno do XLSX está malformado.');
    const flags = readU16(bytes, cursor + 8);
    const method = readU16(bytes, cursor + 10);
    const compressedSize = readU32(bytes, cursor + 20);
    const uncompressedSize = readU32(bytes, cursor + 24);
    const nameLength = readU16(bytes, cursor + 28);
    const extraLength = readU16(bytes, cursor + 30);
    const entryCommentLength = readU16(bytes, cursor + 32);
    const recordEnd = cursor + 46 + nameLength + extraLength + entryCommentLength;
    if (recordEnd > eocd) fail('O índice interno do XLSX está malformado.');
    const name = new TextDecoder().decode(bytes.subarray(cursor + 46, cursor + 46 + nameLength));
    if (flags & 1) fail('Planilhas XLSX criptografadas não são aceitas. Remova a proteção e tente novamente.');
    if (method !== 0 && method !== 8) fail('O arquivo XLSX usa um método de compactação não suportado.');
    if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff) fail('Planilhas XLSX ZIP64 não são aceitas nesta importação.');
    if (name.startsWith('/') || name.includes('\\') || name.split('/').includes('..')) fail('O arquivo XLSX contém um caminho interno inválido.');
    if (uncompressedSize > limits.maxZipEntryBytes) fail('Um componente descompactado da planilha excede 32 MiB. Divida o arquivo e tente novamente.');
    if (uncompressedSize > 0 && (compressedSize === 0 || uncompressedSize / compressedSize > limits.maxCompressionRatio)) fail('A planilha possui um componente compactado com expansão excessiva.');
    totalUncompressed += uncompressedSize;
    if (totalUncompressed > limits.maxZipUncompressedBytes) fail('A planilha excede o limite de 96 MiB após descompactação. Divida o arquivo e tente novamente.');
    cursor = recordEnd;
  }
  if (cursor !== centralOffset + centralSize) fail('O índice interno do XLSX está malformado.');
}

function readU16(bytes, offset) {
  if (offset < 0 || offset + 2 > bytes.length) return -1;
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function readU32(bytes, offset) {
  if (offset < 0 || offset + 4 > bytes.length) return -1;
  return (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0;
}
