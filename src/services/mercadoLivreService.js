import { invokeEdgeFunction } from '@/services/integrationsService';

const SUPABASE_PROVIDER = import.meta.env.VITE_DATA_PROVIDER === 'supabase';

export async function startMercadoLivreConnection(companyId) {
  if (!SUPABASE_PROVIDER) throw new Error('MELI_SUPABASE_PROVIDER_REQUIRED');
  const result = await invokeEdgeFunction('mercadolivre-connect', { company_id: companyId });
  if (!result?.authorization_url || new URL(result.authorization_url).origin !== 'https://auth.mercadolivre.com.br') {
    throw new Error('MELI_AUTHORIZATION_URL_INVALID');
  }
  return result.authorization_url;
}

export async function mercadoLivreAction(companyId, action, params = {}) {
  if (!SUPABASE_PROVIDER) throw new Error('MELI_SUPABASE_PROVIDER_REQUIRED');
  return invokeEdgeFunction('mercadolivre-api', { company_id: companyId, action, ...params });
}

export function mercadoLivreErrorMessage(error) {
  const code = String(error?.code || error?.message || '');
  const messages = {
    MELI_SUPABASE_PROVIDER_REQUIRED: 'A conexão de marketplace requer o backend Supabase deste ambiente.',
    MELI_AUTHORIZATION_URL_INVALID: 'O servidor retornou um endereço OAuth inválido. A conexão foi interrompida.',
    MELI_CONNECTOR_NOT_CONFIGURED: 'A configuração necessária para conectar o Mercado Livre está incompleta no servidor.',
    ENTITLEMENT_CHECK_FAILED: 'Não foi possível confirmar se o plano da empresa permite integrações com marketplaces. Tente novamente mais tarde.',
    UNTRUSTED_NOTIFICATION_SOURCE: 'A notificação recebida não passou pela validação de origem.',
    MELI_CONNECTOR_CONFIG_INVALID: 'A URL de retorno do Mercado Livre não está configurada corretamente.',
    FEATURE_NOT_AVAILABLE: 'O plano atual da empresa não habilita integrações com marketplaces.',
    FORBIDDEN: 'Seu papel não permite esta operação de marketplace.',
    AUTH_REQUIRED: 'Entre novamente para continuar.',
    MELI_TOKEN_REFRESH_IN_PROGRESS: 'A renovação segura do token já está em andamento. Tente novamente em instantes.',
    MELI_TOKEN_REFRESH_UNAVAILABLE: 'Não foi possível iniciar a renovação segura do token.',
    MELI_REFRESH_REAUTH_REQUIRED: 'A autorização expirou. Desconecte e conecte a conta novamente.',
    MELI_SCOPE_OR_ACCESS_DENIED: 'O Mercado Livre não autorizou este recurso para a conta conectada.',
    MELI_RATE_LIMITED: 'O Mercado Livre limitou temporariamente as consultas. Tente mais tarde.',
    MELI_PROVIDER_UNAVAILABLE: 'O Mercado Livre está indisponível no momento.',
    MELI_TIMEOUT: 'O Mercado Livre não respondeu a tempo. Consulte o histórico antes de repetir.',
    MELI_NETWORK_ERROR: 'Não foi possível alcançar o Mercado Livre.',
    MELI_LISTING_PRODUCT_NOT_MAPPED: 'Associe o anúncio a um produto do F7 antes de sincronizar estoque ou preço.',
    MELI_LISTING_SELLER_MISMATCH: 'O anúncio retornado não pertence à conta Mercado Livre conectada; a sincronização foi interrompida.',
    MELI_VARIATIONS_UNSUPPORTED: 'Este anúncio tem variações. Atualizações de estoque e preço exigem um mapeamento de variações ainda não disponível.',
    MELI_STOCK_MUST_BE_INTEGER: 'O estoque do produto precisa ser um número inteiro para ser enviado ao marketplace.',
    EXPLICIT_CONFIRMATION_REQUIRED: 'Confirme a operação para continuar.',
  };
  if (messages[code]) return messages[code];
  if (/FUNCTIONS_FETCH_ERROR|404|Failed to fetch/i.test(code)) return 'O backend do conector ainda não está publicado neste ambiente.';
  return 'Não foi possível concluir a operação do Mercado Livre. Consulte o histórico de sincronização.';
}
