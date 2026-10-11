import { parseCampaignWorkbookBuffer } from '../lib/campaignWorkbookParser.js';

self.addEventListener('message', async (event) => {
  const { id, buffer, fileName } = event.data || {};
  try {
    const workbook = await parseCampaignWorkbookBuffer(buffer, fileName);
    self.postMessage({ id, ok: true, workbook });
  } catch (cause) {
    self.postMessage({ id, ok: false, error: cause instanceof Error ? cause.message : 'Não foi possível analisar a planilha.' });
  }
});
