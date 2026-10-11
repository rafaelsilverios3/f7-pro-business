import React from 'react';
import { ArrowUpRight, Boxes, CircleOff, Package, ShoppingCart, Store, Target, Truck } from 'lucide-react';
import { Link } from 'react-router-dom';
import PageHeader from '@/components/layout/PageHeader';
import { useAuth } from '@/lib/AuthContext';
import { useCompany } from '@/lib/useCompany';
import { getSupabaseClient } from '@/data/providers/supabaseProvider';
import { getVisibleCommerceWorkspaces } from '@/lib/commerceNavigation';

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
        OAuth, anúncios, sincronização de estoque/preços e importação de pedidos ainda não estão implementados.
      </p>
    </article>
  );
}

export default function Commerce() {
  const { user } = useAuth();
  const { company } = useCompany();
  const [memberRole, setMemberRole] = React.useState(import.meta.env.VITE_DATA_PROVIDER === 'supabase' ? '' : String(user?.role || '').toLowerCase());

  React.useEffect(() => {
    let cancelled = false;
    if (import.meta.env.VITE_DATA_PROVIDER !== 'supabase' || !company?.id || !user?.id) {
      setMemberRole(String(user?.role || '').toLowerCase());
      return undefined;
    }
    getSupabaseClient()
      .from('company_users')
      .select('role')
      .eq('company_id', company.id)
      .eq('user_id', user.id)
      .eq('active', true)
      .maybeSingle()
      .then(({ data, error }) => {
        if (!cancelled) setMemberRole(error ? '' : String(data?.role || '').toLowerCase());
      })
      .catch(() => { if (!cancelled) setMemberRole(''); });
    return () => { cancelled = true; };
  }, [company?.id, user?.id, user?.role]);

  const visibleWorkspaces = getVisibleCommerceWorkspaces(memberRole);

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
        {visibleWorkspaces.map((workspace) => <WorkspaceCard key={workspace.title} {...workspace} icon={workspaceIcons[workspace.iconName]} />)}
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm md:col-span-2">
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-700">
              <Boxes className="commerce-muted-icon h-5 w-5" aria-hidden="true" />
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
