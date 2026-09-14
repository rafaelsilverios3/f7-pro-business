const CATEGORY_LABELS = {
  crm_activity: 'CRM',
  opportunity: 'Oportunidades',
  radar: 'Oportunidades',
  automation: 'Automações',
  stock: 'Estoque',
  financial: 'Financeiro',
  sale: 'Vendas',
  purchase: 'Compras',
  quote: 'Vendas',
  attendance: 'Sistema',
  goal: 'Sistema',
  system: 'Sistema',
};

const ENTITY_ROUTES = {
  crm_activity: (id) => `/sales-hub?activity=${encodeURIComponent(id)}`,
  opportunity: (id) => `/sales-hub?opportunity=${encodeURIComponent(id)}`,
  customer: (id) => `/clientes?highlight=${encodeURIComponent(id)}`,
  Product: (id) => `/produtos?highlight=${encodeURIComponent(id)}`,
  product: (id) => `/produtos?highlight=${encodeURIComponent(id)}`,
  FinancialEntry: (id) => `/financeiro?highlight=${encodeURIComponent(id)}`,
  financial_entry: (id) => `/financeiro?highlight=${encodeURIComponent(id)}`,
  Quote: (id) => `/orcamentos?highlight=${encodeURIComponent(id)}`,
  quote: (id) => `/orcamentos?highlight=${encodeURIComponent(id)}`,
  sale: (id) => `/vendas?highlight=${encodeURIComponent(id)}`,
  order: (id) => `/vendas?highlight=${encodeURIComponent(id)}`,
  automation: () => '/automacoes',
  radar: () => '/opportunity-radar',
};

export function notificationCategory(notification = {}) {
  return CATEGORY_LABELS[notification.entity] || CATEGORY_LABELS[notification.type] || 'Sistema';
}

export function notificationRoute(notification = {}) {
  const resolver = ENTITY_ROUTES[notification.entity] || ENTITY_ROUTES[notification.type];
  if (!resolver) return null;
  if (resolver.length > 0 && !notification.entity_id) return null;
  return resolver(notification.entity_id);
}

export function notificationHasAction(notification = {}) {
  return Boolean(notificationRoute(notification));
}

export const NOTIFICATION_CATEGORY_LABELS = CATEGORY_LABELS;
