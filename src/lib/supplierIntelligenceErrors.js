const messages = Object.freeze({
  AI_BUDGET_NOT_CONFIGURED: 'A pesquisa externa está bloqueada porque a empresa ainda não tem orçamento diário de IA configurado. Peça ao Owner Global para configurar um limite e uma moeda válidos.',
  AI_BUDGET_INSUFFICIENT: 'O orçamento diário disponível não cobre esta pesquisa. Nenhuma consulta foi enviada ao provedor.',
  AI_BUDGET_CONFIGURATION_INVALID: 'A configuração financeira da pesquisa precisa ser revisada pelo Owner Global. Nenhuma consulta foi enviada ao provedor.',
  EXTERNAL_RESEARCH_NOT_ALLOWED: 'A pesquisa externa está desativada para esta empresa. Um administrador autorizado pode verificar a permissão de pesquisa web.',
  FEATURE_NOT_AVAILABLE: 'Supplier Intelligence não está incluído no plano atual desta empresa.',
  WEB_RESEARCH_LIMIT_REACHED: 'O limite diário de pesquisas externas foi atingido ou está desativado para esta empresa.',
  WEB_RESEARCH_RATE_NOT_CONFIGURED: 'A tarifa oficial da pesquisa externa está ausente ou ambígua. A consulta foi bloqueada antes de chamar o provedor.',
  EXTERNAL_RESEARCH_BUDGET_UNAVAILABLE: 'Não foi possível reservar o orçamento da pesquisa. Nenhuma consulta foi enviada ao provedor.',
  SUPPLIER_SETTINGS_UNAVAILABLE: 'Não foi possível consultar as permissões e limites de pesquisa desta empresa.',
  WEB_SEARCH_NOT_CONFIGURED: 'O provedor de pesquisa externa não está configurado neste ambiente.',
  WEB_SEARCH_ENDPOINT_INVALID: 'A configuração do provedor de pesquisa externa é inválida.',
  WEB_SEARCH_AUTH_ERROR: 'O provedor de pesquisa externa recusou a autenticação. A administração precisa revisar a credencial no ambiente seguro.',
  WEB_SEARCH_RATE_LIMITED: 'O provedor de pesquisa externa atingiu uma cota ou limite temporário.',
  WEB_SEARCH_UNAVAILABLE: 'O provedor de pesquisa externa está indisponível no momento.',
  WEB_SEARCH_TIMEOUT: 'O provedor de pesquisa externa demorou demais para responder.',
  WEB_SEARCH_NO_RESULTS: 'O provedor respondeu, mas não encontrou resultados para estes termos.',
  WEB_SEARCH_PROVIDER_ERROR: 'O provedor de pesquisa externa retornou uma falha ao processar a consulta.',
  WEB_SEARCH_FAILED: 'Não foi possível concluir a consulta ao provedor de pesquisa externa.',
  SUPPLIER_RESEARCH_FAILED: 'A pesquisa de fornecedores falhou inesperadamente. Tente novamente mais tarde.',
});

export function supplierSearchErrorMessage(error) {
  if (!error || typeof error !== 'object') return messages.SUPPLIER_RESEARCH_FAILED;
  return messages[error.code] || messages.SUPPLIER_RESEARCH_FAILED;
}

export function supplierResearchWarning(failureCodes) {
  const code = Array.isArray(failureCodes) ? failureCodes.find((item) => typeof item === 'string') : null;
  return code ? messages[code] || messages.SUPPLIER_RESEARCH_FAILED : '';
}
