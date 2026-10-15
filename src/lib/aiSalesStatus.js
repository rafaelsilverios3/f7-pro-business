const ACCESS_DENIED_CODES = new Set(['FEATURE_NOT_AVAILABLE', 'FORBIDDEN', 'AUTH_REQUIRED']);

export function aiSalesStatusFromError(cause, companyId, userId) {
  const base = { companyId, userId, errorCode: cause?.code || null };
  if (cause?.code === 'AI_MAINTENANCE') return { ...base, state: 'maintenance' };
  if (cause?.code === 'AI_MAINTENANCE_CONFIGURATION_INVALID') return { ...base, state: 'configuration_error' };
  if (ACCESS_DENIED_CODES.has(cause?.code)) {
    return { ...base, state: 'denied', status_message: cause?.message || 'Seu perfil ou plano não habilita o F7 AI Sales.' };
  }
  return { ...base, state: 'unavailable' };
}

export function aiSalesStatusPresentation(status) {
  if (status.state === 'checking') return { label: 'Verificando dependências', tone: 'border-slate-200 bg-slate-50 text-slate-700', message: 'Validando acesso no servidor. A conversa ficará indisponível até a verificação terminar.' };
  if (status.state === 'maintenance') return { label: 'Em manutenção', tone: 'border-amber-200 bg-amber-50 text-amber-800', message: 'O assistente está temporariamente pausado para manutenção. Nenhuma consulta comercial ou geração por IA foi iniciada.' };
  if (status.state === 'configuration_error') return { label: 'Verificação indisponível', tone: 'border-amber-200 bg-amber-50 text-amber-800', message: 'Não foi possível validar a configuração do assistente. A conversa permanece desativada; tente novamente mais tarde.' };
  if (status.state === 'unavailable') return { label: 'Não verificado', tone: 'border-rose-200 bg-rose-50 text-rose-800', message: 'Não foi possível confirmar a disponibilidade do AI Sales. Tente novamente mais tarde; nenhuma geração por IA será presumida.' };
  if (status.state === 'denied') return { label: 'Acesso indisponível', tone: 'border-amber-200 bg-amber-50 text-amber-800', message: status.status_message || 'O perfil ou plano atual não habilita o F7 AI Sales.' };
  if (status.generation_mode === 'provider_configured_unverified') return { label: 'Configuração detectada · conexão não verificada', tone: 'border-amber-200 bg-amber-50 text-amber-800', message: 'Há configuração de provedor, mas esta tela não testa a conexão. Cada resposta pode usar o provedor somente após autorização e orçamento; em falhas, o sistema identifica a resposta factual como fallback.' };
  return { label: 'Modo factual · sem geração por IA', tone: 'border-sky-200 bg-sky-50 text-sky-800', message: status.status_message || 'As consultas retornam fatos obtidos pelas ferramentas autorizadas. Respostas factuais não são geração por IA.' };
}
