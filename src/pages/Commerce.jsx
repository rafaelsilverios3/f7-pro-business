import React from 'react';
import { AlertCircle, ArrowUpRight, Boxes, CircleOff, Package, RefreshCw, ShoppingCart, Store, Target, Truck } from 'lucide-react';
import { Link } from 'react-router-dom';
import PageHeader from '@/components/layout/PageHeader';
import { useCompany } from '@/lib/useCompany';
import { useCompanyMembership } from '@/hooks/useCompanyMembership';
import { companyMembershipGateState } from '@/lib/companyMembershipGate';
import { getVisibleCommerceWorkspaces } from '@/lib/commerceNavigation';
import MercadoLivreConnector from '@/components/commerce/MercadoLivreConnector';

const workspaceIcons = { supplier: Truck, catalog: Package, orders: ShoppingCart, opportunities: Target };

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
        <span className="commerce-status inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium">
          <CircleOff className="h-3.5 w-3.5" aria-hidden="true" /> Não conectado
        </span>
      </div>
      <p className="mt-2 text-xs leading-5 text-slate-500">
        O conector ainda não está disponível neste ambiente.
      </p>
    </article>
  );
}

export default function Commerce() {
  const { company } = useCompany();
  const membership = useCompanyMembership(company?.id);
  const membershipState = companyMembershipGateState(membership, company?.id);
  const currentMemberRole = membershipState === 'active' ? membership.role : '';
  const visibleWorkspaces = getVisibleCommerceWorkspaces(currentMemberRole);

  return (
    <main data-commerce className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-5 sm:py-8">
      <PageHeader
        title="F7 Commerce"
        subtitle="Central para os fluxos comerciais existentes e a futura operação multicanal."
      />

      <section aria-labelledby="commerce-marketplaces" className="commerce-marketplace-section mb-5 rounded-2xl border p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white text-blue-700 shadow-sm">
              <Store className="commerce-muted-icon h-5 w-5" aria-hidden="true" />
            </span>
            <div>
              <h2 id="commerce-marketplaces" className="font-semibold text-slate-900">Marketplaces</h2>
              <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-600">
                Conecte canais autorizados e acompanhe a sincronização sob demanda. Operações que alteram anúncios exigem confirmação explícita.
              </p>
            </div>
          </div>
          <Link to="/sales-hub" className="inline-flex min-h-9 shrink-0 items-center justify-center gap-2 rounded-lg bg-blue-700 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2">
            Abrir Sales Hub<ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
          </Link>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {membershipState === 'loading' ? <article role="status" className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-600">Verificando vínculo e permissões da empresa…</article>
            : membershipState === 'error' ? <article role="alert" className="flex items-start justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800"><span className="flex items-start gap-2"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />Não foi possível verificar seu vínculo com a empresa. Nenhuma integração foi consultada.</span><button type="button" onClick={membership.refresh} className="inline-flex shrink-0 items-center gap-1 font-medium underline"><RefreshCw className="h-3.5 w-3.5" />Tentar novamente</button></article>
              : membershipState === 'inactive' ? <article role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">Não foi encontrado um vínculo ativo para esta empresa. Nenhuma integração foi consultada.</article>
                : <MercadoLivreConnector memberRole={currentMemberRole} />}
          <MarketplaceReadinessCard name="Shopee" />
        </div>
        <p className="mt-3 text-xs text-slate-500">
          O Sales Hub mantém os canais e vínculos de produtos já existentes; cadastrar um canal não significa que ele esteja autenticado ou sincronizado.
        </p>
      </section>

      <section aria-label="Áreas comerciais existentes" className="grid gap-4 md:grid-cols-2">
        {visibleWorkspaces.map((workspace) => <WorkspaceCard key={workspace.title} {...workspace} icon={workspaceIcons[workspace.iconName]} />)}
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm md:col-span-2">
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-700">
              <Boxes className="commerce-muted-icon h-5 w-5" aria-hidden="true" />
            </span>
            <div>
              <h2 className="font-semibold text-slate-900">Canais e integrações</h2>
              <p className="mt-1 text-sm leading-6 text-slate-500">
                O Sales Hub mantém os canais e vínculos genéricos; o conector Mercado Livre desta etapa registra e sincroniza a conta autorizada.
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
