import { validateCampaignWorkbookInput } from '../lib/campaignWorkbookGuards.js';

export const CAMPAIGN_WORKBOOK_PARSE_TIMEOUT_MS = 30000;

/**
 * @param {File} file
 * @param {{ signal?: AbortSignal, workerFactory?: () => Worker, timeoutMs?: number }} [options]
 */
export async function parseCampaignWorkbookInWorker(file, options = {}) {
  const { signal, timeoutMs = CAMPAIGN_WORKBOOK_PARSE_TIMEOUT_MS } = options;
  if (!file || typeof file.arrayBuffer !== 'function') throw new Error('Selecione um arquivo de planilha válido.');
  if (file.size > 15 * 1024 * 1024) throw new Error('A planilha excede o limite de 15 MiB. Se necessário, divida o arquivo em campanhas menores.');
  if (signal?.aborted) throw abortError();
  let buffer;
  try {
    buffer = await file.arrayBuffer();
  } catch {
    throw new Error('Não foi possível ler o arquivo selecionado. Tente selecioná-lo novamente.');
  }
  if (signal?.aborted) throw abortError();
  validateCampaignWorkbookInput(buffer, file.name);
  const worker = options.workerFactory
    ? options.workerFactory()
    : new Worker(new URL('../workers/campaignWorkbook.worker.js', import.meta.url), { type: 'module' });
  const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      worker.removeEventListener('message', onMessage);
      worker.removeEventListener('error', onError);
      worker.removeEventListener('messageerror', onError);
      worker.terminate();
      callback(value);
    };
    const onAbort = () => finish(reject, abortError());
    const onMessage = (event) => {
      if (event.data?.id !== id) return;
      if (event.data.ok) finish(resolve, event.data.workbook);
      else finish(reject, new Error(event.data.error || 'Não foi possível analisar a planilha.'));
    };
    const onError = () => finish(reject, new Error('A análise da planilha falhou. Verifique o arquivo ou tente uma planilha menor.'));
    const timer = setTimeout(() => finish(reject, new Error('A análise excedeu 30 segundos e foi cancelada. Reduza a planilha e tente novamente.')), timeoutMs);
    worker.addEventListener('message', onMessage);
    worker.addEventListener('error', onError);
    worker.addEventListener('messageerror', onError);
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) { onAbort(); return; }
    try { worker.postMessage({ id, buffer, fileName: file.name }, [buffer]); }
    catch { finish(reject, new Error('Não foi possível iniciar a análise isolada da planilha.')); }
  });
}

function abortError() {
  return new DOMException('Análise da planilha cancelada.', 'AbortError');
}
