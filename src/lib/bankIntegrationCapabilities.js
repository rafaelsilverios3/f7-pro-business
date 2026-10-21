export const BANK_INTEGRATION_MODES = Object.freeze({
  manual: { id: 'manual', label: 'Manual', available: true, reason: 'Disponível para qualquer instituição; o recebimento é confirmado manualmente.' },
  mercado_pago_connect: { id: 'mercado_pago_connect', label: 'Mercado Pago da empresa', available: false, reason: 'A autorização OAuth de contas recebedoras de empresas ainda não está conectada. O checkout da assinatura F7 é separado.' },
  bank_api: { id: 'bank_api', label: 'API bancária', available: false, reason: 'Nenhuma API bancária de recebimento foi configurada nesta instalação.' },
  open_finance: { id: 'open_finance', label: 'Open Finance', available: false, reason: 'Não há iniciador ou consentimento Open Finance conectado.' },
  statement_import: { id: 'statement_import', label: 'Importação de extrato', available: false, reason: 'Importação OFX/CSV ainda não está disponível; a conciliação manual usa os lançamentos existentes.' },
});

export function getBankIntegrationCapabilities({ connectedProviders = [] } = {}) {
  const connected = new Set((connectedProviders || []).filter(Boolean));
  return Object.values(BANK_INTEGRATION_MODES).map((mode) => {
    if (mode.id === 'mercado_pago_connect' && connected.has('mercado_pago_connect')) return { ...mode, available: true, reason: 'A conta recebedora da empresa está autorizada.' };
    return mode;
  });
}

