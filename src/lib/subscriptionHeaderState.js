const STATUS_LABELS = {
  active: 'Ativo',
  pending: 'Pendente',
  expired: 'Expirado',
  cancelled: 'Cancelado',
  canceled: 'Cancelado',
  suspended: 'Suspenso',
};

const asTimestamp = (value) => {
  const timestamp = new Date(value || 0).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
};

/**
 * Resolves the tenant subscription state shown in the authenticated header.
 * Loading and API errors are intentionally distinct from a missing subscription.
 */
export function resolveSubscriptionHeaderState(subscription, { loading = false, error = null, now = Date.now() } = {}) {
  if (loading) return { state: 'loading', title: null, detail: null };
  if (error) return { state: 'error', title: 'Plano indisponível', detail: 'Não foi possível carregar. Tente novamente.' };

  const status = String(subscription?.status || '').toLowerCase();
  const plan = String(subscription?.plan || '').trim().toUpperCase();
  const trialEndsAt = asTimestamp(subscription?.trial_ends_at);
  const isTrial = status === 'trial' && trialEndsAt > now;
  const expired = status === 'expired' || (status === 'trial' && trialEndsAt > 0 && trialEndsAt <= now);

  if (isTrial) return { state: 'trial', title: 'Teste grátis', detail: `${Math.max(0, Math.ceil((trialEndsAt - now) / 3_600_000))}h restantes` };
  if (expired) return { state: 'expired', title: 'Teste encerrado', detail: 'Escolher plano' };
  if (status === 'active' && plan) return { state: 'active', title: `Plano atual • ${plan}`, detail: STATUS_LABELS[status] };
  if (plan && status) return { state: status, title: `Plano • ${plan}`, detail: STATUS_LABELS[status] || status };
  return { state: 'none', title: 'Sem plano ativo', detail: 'Escolha um plano' };
}

