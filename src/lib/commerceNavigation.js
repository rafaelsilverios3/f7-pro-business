import { can } from './permissions.js';

export const COMMERCE_WORKSPACES = [
  {
    title: 'Fornecedores',
    description: 'Reaproveite o cadastro atual de fornecedores, compras e inteligência de fornecedores.',
    iconName: 'supplier',
    links: [
      { to: '/compras', label: 'Compras e fornecedores', permission: 'purchases.view' },
      { to: '/supplier-intelligence', label: 'Inteligência de fornecedores', permission: 'supplier_intelligence.view' },
    ],
  },
  {
    title: 'Catálogo e estoque',
    description: 'Gerencie produtos, preços e disponibilidade nos módulos existentes.',
    iconName: 'catalog',
    links: [
      { to: '/produtos', label: 'Catálogo de produtos', permission: 'products.view' },
      { to: '/estoque', label: 'Estoque', permission: 'inventory.view' },
      { to: '/precificacao', label: 'Precificação', permission: 'pricing.view' },
    ],
  },
  {
    title: 'Pedidos',
    description: 'Acesse vendas, orçamentos e pedidos de compra já mantidos pelo sistema.',
    iconName: 'orders',
    links: [
      { to: '/vendas', label: 'Vendas', permission: 'sales.view' },
      { to: '/orcamentos', label: 'Orçamentos', permission: 'quotes.view' },
      { to: '/compras', label: 'Pedidos de compra', permission: 'purchases.view' },
    ],
  },
  {
    title: 'Oportunidades comerciais',
    description: 'Use as oportunidades e sinais de mercado existentes, sem criar um pipeline paralelo.',
    iconName: 'opportunities',
    links: [
      { to: '/opportunities', label: 'F7 Opportunity', permission: 'opportunity.view' },
      { to: '/market-intelligence', label: 'Market Intelligence', permission: 'market_intelligence.view' },
      { to: '/opportunity-radar', label: 'Opportunity Radar', permission: 'opportunity_radar.view' },
    ],
  },
];

export function getVisibleCommerceWorkspaces(role) {
  return COMMERCE_WORKSPACES.map((workspace) => ({
    ...workspace,
    links: workspace.links.filter((link) => can({ role }, link.permission)),
  })).filter((workspace) => workspace.links.length > 0);
}
