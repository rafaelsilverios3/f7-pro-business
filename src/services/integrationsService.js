import { getDataProvider } from '@/data/providerSelector';
import { getSupabaseClient } from '@/data/providers/supabaseProvider';

const SAFE_INTEGRATION_FIELDS = ['id', 'company_id', 'provider', 'status', 'external_account_id', 'external_phone_id', 'external_business_id', 'created_at', 'updated_at'];

export const sanitizeIntegration = (row = {}) => Object.fromEntries(SAFE_INTEGRATION_FIELDS.filter((key) => row[key] !== undefined).map((key) => [key, row[key]]));

function redactDiagnosticText(value) {
  return String(value || '')
    .replace(/Bearer\s+[^\s"']+/gi, 'Bearer [REDACTED]')
    .replace(/(access[_-]?token|app[_-]?secret|verify[_-]?token|authorization)\s*[:=]\s*[^,\s}\]]+/gi, '$1=[REDACTED]')
    .slice(0, 280);
}

export function safeMetaDiagnostic(error = {}) {
  const meta = error.meta && typeof error.meta === 'object' ? error.meta : null;
  if (!meta) return null;
  return {
    httpStatus: error.httpStatus ?? null,
    code: meta.code ?? error.metaCode ?? null,
    subcode: meta.subcode ?? error.metaSubcode ?? null,
    type: typeof meta.type === 'string' ? redactDiagnosticText(meta.type) : null,
    message: typeof meta.message === 'string' ? redactDiagnosticText(meta.message) : null,
    graphVersion: error.graphVersion || null,
  };
}

export function safeInternalDiagnostic(error = {}) {
  if (error.code !== 'INTERNAL_PROVIDER_ERROR') return null;
  return { httpStatus: error.httpStatus ?? null, stage: typeof error.stage === 'string' ? error.stage : null, internalCode: typeof error.internalCode === 'string' ? error.internalCode : null };
}

export async function listIntegrations(companyId) {
  if (!companyId) return [];
  if (import.meta.env.VITE_DATA_PROVIDER !== 'supabase') {
    try { return (await getDataProvider().entity('CompanyIntegration').filter({ company_id: companyId }, '-updated_date', 50)).map(sanitizeIntegration); } catch { return []; }
  }
  const { data, error } = await getSupabaseClient().from('company_integrations').select('id,company_id,provider,status,external_account_id,external_phone_id,external_business_id,created_at,updated_at').eq('company_id', companyId).order('updated_at', { ascending: false });
  if (error) return [];
  return (data || []).map(sanitizeIntegration);
}

export async function listIntegrationLogs(companyId) {
  if (!companyId) return [];
  if (import.meta.env.VITE_DATA_PROVIDER !== 'supabase') {
    try { return await getDataProvider().entity('IntegrationLog').filter({ company_id: companyId }, '-created_date', 20); } catch { return []; }
  }
  const { data, error } = await getSupabaseClient().from('integration_logs').select('id,provider,event,status,external_id,created_at').eq('company_id', companyId).order('created_at', { ascending: false }).limit(20);
  if (error) return [];
  return data || [];
}

export async function checkIntegrationHealth(companyId) {
  if (import.meta.env.VITE_DATA_PROVIDER !== 'supabase') return null;
  const { data, error } = await getSupabaseClient().functions.invoke('integration-health', { body: companyId ? { company_id: companyId } : {} });
  if (error) throw error;
  return data;
}

export async function invokeEdgeFunction(functionName, body, options = {}) {
  if (import.meta.env.VITE_DATA_PROVIDER !== 'supabase') {
    return getDataProvider().rpc(functionName, { body });
  }

  const supabase = getSupabaseClient();
  const { data: { session } = {} } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error('AUTH_REQUIRED');

  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  const publicKey = import.meta.env.VITE_SUPABASE_ANON_KEY || import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (!supabaseUrl || !publicKey) throw new Error('Supabase não configurado.');

  const method = options.method || 'POST';
  const endpoint = new URL(`${supabaseUrl.replace(/\/$/, '')}/functions/v1/${functionName}`);
  if (method === 'GET' && options.query && typeof options.query === 'object') {
    for (const [key, value] of Object.entries(options.query)) {
      if (typeof value === 'string' && value.length > 0) endpoint.searchParams.set(key, value);
    }
  }
  const response = await fetch(endpoint, {
    method,
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      apikey: publicKey,
      'Content-Type': 'application/json',
    },
    ...(method === 'GET' ? {} : { body: JSON.stringify(body) }),
  });
  let detail = null;
  try { detail = await response.json(); } catch { /* non-JSON provider errors remain generic */ }
  if (!response.ok) throw createIntegrationError(detail, response.status);
  if (detail?.code && detail.code !== 'OK') throw createIntegrationError(detail, response.status);
  return detail;
}

function createIntegrationError(rawDetail, httpStatus) {
  const detail = rawDetail && typeof rawDetail === 'object' ? rawDetail : {};
  const safeDetail = detail;
  const rawMeta = safeDetail.meta && typeof safeDetail.meta === 'object' ? safeDetail.meta : {};
  const meta = {
    type: typeof rawMeta.type === 'string' ? redactDiagnosticText(rawMeta.type) : null,
    code: rawMeta.code ?? safeDetail.meta_code ?? null,
    subcode: rawMeta.subcode ?? safeDetail.meta_subcode ?? null,
    message: typeof rawMeta.message === 'string' ? redactDiagnosticText(rawMeta.message) : null,
  };
  const metaCode = meta.code;
  const metaSubcode = meta.subcode;
  const safeStage = typeof detail?.stage === 'string' ? detail.stage.slice(0, 80) : null;
  const safeInternalCode = typeof detail?.internal_error_code === 'string' ? detail.internal_error_code.slice(0, 80) : null;
  const assistantMessages = {
    WHATSAPP_PROVIDER_DISABLED: 'A validação da Meta está desabilitada neste ambiente.',
    OUTBOUND_DISABLED: 'O envio de mensagens está desabilitado neste ambiente.',
    AI_DISABLED: 'A IA está desativada neste ambiente.',
    AI_PROVIDER_NOT_CONFIGURED: 'O provedor de IA ainda não está configurado.',
    AI_PROVIDER_CONFIG_INVALID: 'A configuração do provedor de IA é inválida.',
    AI_PROVIDER_AUTH_ERROR: 'O provedor de IA recusou a autenticação.',
    AI_PROVIDER_RATE_LIMITED: 'O provedor de IA atingiu um limite temporário.',
    AI_PROVIDER_QUOTA_OR_RATE_LIMIT: 'A cota ou o limite do provedor de IA foi atingido.',
    AI_PROVIDER_QUOTA_EXCEEDED: 'A cota do provedor de IA foi atingida.',
    AI_PROVIDER_UNAVAILABLE: 'O provedor de IA está indisponível no momento.',
    AI_PROVIDER_TIMEOUT: 'O provedor de IA demorou demais para responder.',
    AI_MODEL_NOT_AVAILABLE: 'O modelo de IA configurado não está disponível para este provedor.',
    AI_CREDITS_CONFIRMATION_REQUIRED: 'Confirme o custo máximo da análise para continuar.',
    AI_CREDITS_INSUFFICIENT: 'O saldo de F7 AI Credits é insuficiente para esta solicitação.',
    AI_CREDITS_RATE_UNAVAILABLE: 'Não há tarifa vigente para calcular esta análise; o consumo está bloqueado.',
    AI_CREDITS_FX_UNCONFIGURED: 'O câmbio necessário para calcular os créditos ainda não está configurado.',
    AI_CREDITS_UNAVAILABLE: 'O controle de créditos está indisponível; a análise foi bloqueada.',
    AI_PROVIDER_MODEL_NOT_FOUND: 'O modelo de IA configurado não foi encontrado no provedor.',
    AI_JSON_MODE_UNSUPPORTED: 'O provedor de IA não aceita o formato JSON configurado.',
    AI_STRUCTURED_OUTPUT_UNSUPPORTED: 'O provedor de IA não aceitou Structured Outputs nesta chamada.',
    AI_INVALID_RESPONSE: 'O provedor de IA retornou uma resposta inválida.',
    ASSISTED_MODE_REQUIRED: 'Ative o modo assistido para gerar sugestões.',
    FEATURE_NOT_AVAILABLE: 'A IA não está disponível para esta empresa.',
    RATE_LIMITED: 'Limite temporário de sugestões atingido.',
    SUPPLIER_SAVE_FAILED: 'Falha ao salvar fornecedor.',
    PLAN_PRICE_NOT_CONFIGURED: 'O preço deste plano ainda não foi definido.',
    MERCADO_PAGO_NOT_CONFIGURED: 'O checkout ainda não está disponível: o provedor de pagamentos não foi configurado.',
    CARD_TOKEN_REQUIRED: 'O token seguro do cartão não foi recebido. Confira os dados no formulário do Mercado Pago.',
    MERCADO_PAGO_ENVIRONMENT_NOT_CONFIGURED: 'O ambiente de pagamentos ainda não foi configurado.',
    MERCADO_PAGO_CREDENTIAL_ENVIRONMENT_UNVERIFIED: 'Não foi possível confirmar que a credencial corresponde ao ambiente configurado. O checkout permanece bloqueado; confira as credenciais de teste no painel do Mercado Pago.',
    MERCADO_PAGO_WEBHOOK_NOT_CONFIGURED: 'O checkout está bloqueado até a configuração do webhook seguro.',
    PRODUCTION_PAYMENTS_DISABLED: 'Pagamentos reais estão desativados neste ambiente.',
    CARD_CHECKOUT_REQUIRES_TOKENIZATION: 'O checkout seguro de cartão ainda não está configurado neste ambiente.',
    CHECKOUT_STATE_RETRYABLE: 'A autorização foi iniciada, mas a confirmação local está pendente. Aguarde e tente atualizar o status.',
    MERCADO_PAGO_RESULT_UNCERTAIN: 'O provedor ainda está confirmando o resultado. Não repita o pagamento agora; atualize o status em instantes.',
    MERCADO_PAGO_RESPONSE_INCOMPLETE: 'O provedor não confirmou todos os dados do checkout. A assinatura não foi ativada.',
    MERCADO_PAGO_RESPONSE_MISMATCH: 'Os dados confirmados pelo provedor não correspondem ao plano selecionado.',
    PLAN_PRICE_INVALID: 'O preço ou a moeda do plano precisa ser revisado antes do checkout.',
    BILLING_PERIOD_UNSUPPORTED: 'A periodicidade deste plano não é compatível com o checkout recorrente.',
    PAYER_EMAIL_REQUIRED: 'Confirme um e-mail válido na conta antes de contratar o plano.',
    CHECKOUT_PRICE_CHANGED: 'O preço do plano mudou. Atualize a página para iniciar um novo checkout.',
    SUBSCRIPTION_ACTION_NOT_ALLOWED: 'Esta ação não está disponível para o estado atual da assinatura.',
    SUBSCRIPTION_CONTROL_IN_PROGRESS: 'Outra atualização da assinatura está em andamento. Aguarde alguns instantes.',
    SUBSCRIPTION_RESULT_UNCERTAIN: 'O provedor ainda está confirmando a alteração. Atualize o status antes de tentar novamente.',
    SUBSCRIPTION_STATE_RETRYABLE: 'A alteração foi enviada, mas a confirmação local está pendente. Atualize o status em instantes.',
    SUBSCRIPTION_PROVIDER_REJECTED: 'O Mercado Pago não aceitou a alteração da assinatura.',
    SUBSCRIPTION_PROVIDER_RESPONSE_MISMATCH: 'O Mercado Pago retornou um estado diferente do solicitado. O acesso não foi alterado localmente.',
    FREE_PLAN_NO_PAYMENT_REQUIRED: 'O plano gratuito não exige pagamento.',
  };
  const message = safeDetail.code === 'SUPPLIER_SAVE_FAILED' && safeDetail.detail
    ? `Falha ao salvar fornecedor (${redactDiagnosticText(safeDetail.detail)}).`
    : metaCode != null
    ? `Meta recusou a validação do número. Código: ${metaCode}${metaSubcode != null ? `/${metaSubcode}` : ''}. Verifique token, permissões e vínculo com a conta WhatsApp Business.`
    : safeDetail.code === 'INTERNAL_PROVIDER_ERROR' ? `Falha interna na integração.${safeStage ? ` Etapa: ${safeStage}.` : ''}${safeInternalCode ? ` Código interno: ${safeInternalCode}.` : ''}`
      : assistantMessages[safeDetail.code]
        || (typeof safeDetail.message === 'string' ? redactDiagnosticText(safeDetail.message) : 'Não foi possível concluir a ação.');
  const cause = new Error(message);
  Object.assign(cause, {
    code: detail?.code || null,
    providerStatus: detail?.provider_status || null,
    meta,
    metaCode,
    metaSubcode,
    graphVersion: detail?.graph_version ? redactDiagnosticText(detail.graph_version) : null,
    httpStatus: detail?.http_status || httpStatus || null,
    stage: typeof detail?.stage === 'string' ? detail.stage.slice(0, 80) : null,
    internalCode: typeof detail?.internal_code === 'string' ? detail.internal_code.slice(0, 80) : typeof detail?.internal_error_code === 'string' ? detail.internal_error_code.slice(0, 80) : null,
    aiCreditQuote: detail?.code === 'AI_CREDITS_CONFIRMATION_REQUIRED' && detail?.ai_credit_quote && typeof detail.ai_credit_quote === 'object' ? detail.ai_credit_quote : null,
  });
  return cause;
}

export const connectWhatsApp = (companyId, phoneNumberId) => invokeEdgeFunction('whatsapp-connect', { company_id: companyId, phone_number_id: phoneNumberId });
export const disconnectWhatsApp = (companyId) => invokeEdgeFunction('whatsapp-disconnect', { company_id: companyId });
export const testWhatsAppConnection = (companyId) => invokeEdgeFunction('whatsapp-test', { company_id: companyId });
