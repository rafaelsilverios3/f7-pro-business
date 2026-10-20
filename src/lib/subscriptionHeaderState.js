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

export function resolveSubscriptionStatus(subscription, now = Date.now()) {
  const status = String(subscription?.status || '').toLowerCase();
  if (status === 'active') {
    const periodEnd = asTimestamp(subscription?.current_period_end);
    if (periodEnd > 0 && periodEnd <= now) return 'expired';
  }
  if (status === 'trial') {
    const trialEnd = asTimestamp(subscription?.trial_ends_at);
    if (trialEnd > 0 && trialEnd <= now) return 'expired';
  }
  return status;
}

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
  const periodEndsAt = asTimestamp(subscription?.current_period_end);
  const isTrial = status === 'trial' && trialEndsAt > now;
  const expired = status === 'expired'
    || (status === 'trial' && trialEndsAt > 0 && trialEndsAt <= now)
    || (status === 'active' && periodEndsAt > 0 && periodEndsAt <= now);

  if (isTrial) return { state: 'trial', title: 'Teste grátis', detail: `${Math.max(0, Math.ceil((trialEndsAt - now) / 3_600_000))}h restantes` };
  if (expired) {
    const trialExpired = status === 'trial' || (status === 'expired' && trialEndsAt > 0 && trialEndsAt <= now);
    return { state: 'expired', title: trialExpired ? 'Teste encerrado' : `Assinatura encerrada${plan ? ` • ${plan}` : ''}`, detail: 'Escolher plano' };
  }
  if (status === 'active' && plan) return { state: 'active', title: `Plano atual • ${plan}`, detail: STATUS_LABELS[status] };
  if (plan && status) return { state: status, title: `Plano • ${plan}`, detail: STATUS_LABELS[status] || status };
  return { state: 'none', title: 'Sem plano ativo', detail: 'Escolha um plano' };
}

