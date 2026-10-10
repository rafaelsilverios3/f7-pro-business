import React from 'react';
import { ArrowUpRight, Boxes, CircleOff, Package, ShoppingCart, Store, Target, Truck } from 'lucide-react';
import { Link } from 'react-router-dom';
import PageHeader from '@/components/layout/PageHeader';

const workspaces = [
  {
    title: 'Fornecedores',
    description: 'Reaproveite o cadastro atual de fornecedores, compras e inteligência de fornecedores.',
    icon: Truck,
    links: [
      { to: '/compras', label: 'Compras e fornecedores' },
      { to: '/supplier-intelligence', label: 'Inteligência de fornecedores' },
    ],
  },
  {
    title: 'Catálogo e estoque',
    description: 'Gerencie produtos, preços e disponibilidade nos módulos existentes.',
    icon: Package,
    links: [
      { to: '/produtos', label: 'Catálogo de produtos' },
      { to: '/estoque', label: 'Estoque' },
      { to: '/precificacao', label: 'Precificação' },
    ],
  },
  {
    title: 'Pedidos',
    description: 'Acesse vendas, orçamentos e pedidos de compra já mantidos pelo sistema.',
    icon: ShoppingCart,
    links: [
      { to: '/vendas', label: 'Vendas' },
      { to: '/orcamentos', label: 'Orçamentos' },
      { to: '/compras', label: 'Pedidos de compra' },
    ],
  },
  {
    title: 'Oportunidades comerciais',
    description: 'Use as oportunidades e sinais de mercado existentes, sem criar um pipeline paralelo.',
    icon: Target,
    links: [
      { to: '/opportunities', label: 'F7 Opportunity' },
      { to: '/market-intelligence', label: 'Market Intelligence' },
      { to: '/opportunity-radar', label: 'Opportunity Radar' },
    ],
  },
];

function WorkspaceCard({ title, description, icon: Icon, links }) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-700">
          <Icon className="h-5 w-5" aria-hidden="true" />
        </span>
        <div>
          <h2 className="font-semibold text-slate-900">{title}</h2>
          <p className="mt-1 text-sm leading-6 text-slate-500">{description}</p>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        {links.map((link) => (
          <Link key={link.to + link.label} to={link.to} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-xs font-medium text-slate-700 transition hover:border-blue-300 hover:bg-blue-50 hover:text-blue-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">
            {link.label}<ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
          </Link>
        ))}
      </div>
    </section>
  );
}

function MarketplaceReadinessCard({ name }) {
  return (
    <article className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="font-medium text-slate-900">{name}</h3>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-medium text-slate-600">
          <CircleOff className="h-3.5 w-3.5" aria-hidden="true" /> Não conectado
        </span>
      </div>
      <p className="mt-2 text-xs leading-5 text-slate-500">
        OAuth, anúncios, sincronização de estoque/preços e importação de pedidos ainda não estão implementados.
      </p>
    </article>
  );
}

export default function Commerce() {
  return (
    <main className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-5 sm:py-8">
      <PageHeader
        title="F7 Commerce"
        subtitle="Central para os fluxos comerciais existentes e a futura operação multicanal."
      />

      <section aria-labelledby="commerce-marketplaces" className="mb-5 rounded-2xl border border-blue-200 bg-blue-50/70 p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white text-blue-700 shadow-sm">
              <Store className="h-5 w-5" aria-hidden="true" />
            </span>
            <div>
              <h2 id="commerce-marketplaces" className="font-semibold text-slate-900">Marketplaces</h2>
              <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-600">
                Esta etapa não conecta contas externas nem publica anúncios. Os cartões abaixo mostram a disponibilidade real desta fundação, sem simular sincronizações.
              </p>
            </div>
          </div>
          <Link to="/sales-hub" className="inline-flex min-h-9 shrink-0 items-center justify-center gap-2 rounded-lg bg-blue-700 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2">
            Abrir Sales Hub<ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
          </Link>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <MarketplaceReadinessCard name="Mercado Livre" />
          <MarketplaceReadinessCard name="Shopee" />
        </div>
        <p className="mt-3 text-xs text-slate-500">
          O Sales Hub mantém os canais e vínculos de produtos já existentes; cadastrar um canal não significa que ele esteja autenticado ou sincronizado.
        </p>
      </section>

      <section aria-label="Áreas comerciais existentes" className="grid gap-4 md:grid-cols-2">
        {workspaces.map((workspace) => <WorkspaceCard key={workspace.title} {...workspace} />)}
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm md:col-span-2">
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-700">
              <Boxes className="h-5 w-5" aria-hidden="true" />
            </span>
            <div>
              <h2 className="font-semibold text-slate-900">Canais e integrações</h2>
              <p className="mt-1 text-sm leading-6 text-slate-500">
                Use o Sales Hub para consultar canais e os módulos existentes para as operações da empresa. Mercado Livre e Shopee ainda não têm conexão disponível.
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <Link to="/sales-hub" className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-xs font-medium text-slate-700 hover:border-blue-300 hover:bg-blue-50 hover:text-blue-800">Canais de venda<ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" /></Link>
              </div>
            </div>
          </div>
        </section>
      </section>
    </main>
  );
}
