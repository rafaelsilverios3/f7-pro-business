import { Toaster } from "@/components/ui/toaster"
import React from 'react';
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClientInstance } from '@/lib/query-client'
import { BrowserRouter as Router, Navigate, Outlet, Route, Routes, useLocation, useOutletContext } from 'react-router-dom';
import PageNotFound from './lib/PageNotFound';
import { AuthProvider, useAuth } from '@/lib/AuthContext';
import { CompanyProvider } from '@/contexts/CompanyContext';
import UserNotRegisteredError from '@/components/UserNotRegisteredError';
import ScrollToTop from './components/ScrollToTop';
// Add page imports here
import Layout from './components/layout/Layout.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Clientes from './pages/Clientes.jsx';
import Produtos from './pages/Produtos.jsx';
import Estoque from './pages/Estoque.jsx';
import Vendas from './pages/Vendas.jsx';
import Financeiro from './pages/Financeiro.jsx';
import Configuracoes from './pages/Configuracoes.jsx';
import AssistenteConfiguracao from './pages/AssistenteConfiguracao.jsx';
import Integracoes from './pages/Integracoes.jsx';
import Orcamentos from './pages/Orcamentos.jsx';
import Compras from './pages/Compras.jsx';
import Metas from './pages/Metas.jsx';
import Atendimento from './pages/Atendimento.jsx';
import Automacoes from './pages/Automacoes.jsx';
import Intelligence from './pages/Intelligence.jsx';
import Relatorios from './pages/Relatorios.jsx';
import Marketing from './pages/Marketing.jsx';
import Campanhas from './pages/Campanhas.jsx';
import Notificacoes from './pages/Notificacoes.jsx';
import Onboarding from './pages/Onboarding.jsx';
import Academy from './pages/Academy.jsx';
import Usuarios from './pages/Usuarios.jsx';
import PDV from './pages/PDV.jsx';
import Precificacao from './pages/Precificacao.jsx';
import Producao from './pages/Producao.jsx';
import Storefront from './pages/Storefront.jsx';
import Opportunities from './pages/Opportunities.jsx';
import SupplierIntelligence from './pages/SupplierIntelligence.jsx';
import MarketIntelligence from './pages/MarketIntelligence.jsx';
import SalesHub from './pages/SalesHub.jsx';
import AiSalesAssistant from './pages/AiSalesAssistant.jsx';
import OpportunityRadar from './pages/OpportunityRadar.jsx';
import AIObservability from './pages/AIObservability.jsx';
import PlatformAdmin from './pages/PlatformAdmin.jsx';
import Login from './pages/Login.jsx';
import Register from './pages/Register.jsx';
import ForgotPassword from './pages/ForgotPassword.jsx';
import ResetPassword from './pages/ResetPassword.jsx';
import Invite from './pages/Invite.jsx';
import Checkout from './pages/Checkout.jsx';
import SubscriptionBilling from './pages/SubscriptionBilling.jsx';
import TrialExpired from './pages/TrialExpired.jsx';
import FeatureLocked from './pages/FeatureLocked.jsx';
import PublicSite from './pages/PublicSite.jsx';
import Commerce from './pages/Commerce.jsx';
import TenantIsolationAuditTemporary from './pages/TenantIsolationAuditTemporary.jsx';
import ErrorBoundary from '@/components/ErrorBoundary';
import { useCompany } from '@/lib/useCompany';
import { can } from '@/lib/permissions';
import { getSupabaseClient } from '@/data/providers/supabaseProvider';
import { trialActive, trialExpired, TRIAL_ALLOWED_PATHS, FEATURE_REQUIREMENTS } from '@/services/subscriptionService';
import { canUseFeature } from '@/services/planService';
import { resolveSubscriptionGate } from '@/lib/subscriptionGate';

const CompanyGuard = () => {
  const { company, loading } = useCompany();
  const layoutContext = useOutletContext() || {};
  const location = useLocation();
  const { subscription = null, subscriptionLoading = false, subscriptionError = null } = layoutContext;
  if (loading) return <div className="fixed inset-0 flex items-center justify-center"><div className="h-8 w-8 animate-spin rounded-full border-4 border-slate-200 border-t-slate-800" /></div>;
  if (subscriptionLoading) return <div className="fixed inset-0 flex items-center justify-center"><div className="h-8 w-8 animate-spin rounded-full border-4 border-slate-200 border-t-slate-800" /></div>;
  if (!company) return <Navigate to="/onboarding" replace />;
  if (trialExpired(subscription) && !['/assinatura', '/checkout'].includes(location.pathname)) return <TrialExpired />;
  if (trialActive(subscription) && !TRIAL_ALLOWED_PATHS.some((path) => location.pathname === path || location.pathname.startsWith(`${path}/`))) return <FeatureLocked path={location.pathname} />;
  const requirement = FEATURE_REQUIREMENTS[location.pathname];
  const gate = resolveSubscriptionGate({ subscription, loading: subscriptionLoading, error: subscriptionError, requirement, canUse: canUseFeature });
  if (gate.state === 'error') return <FeatureLocked path={location.pathname} state="error" onRetry={layoutContext.retrySubscription} />;
  if (gate.state === 'blocked') return <FeatureLocked path={location.pathname} state={gate.reason} />;
  return <Outlet context={{ ...layoutContext, company, subscription, subscriptionLoading, subscriptionError }} />;
};

function Forbidden() {
  return <div className="mx-auto mt-20 max-w-lg rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm"><h1 className="text-xl font-semibold text-slate-900">Acesso restrito</h1><p className="mt-2 text-sm text-slate-500">Você não tem permissão para acessar esta área.</p></div>;
}

function RoleGuard({ permission, children }) {
  const { user } = useAuth();
  const { company } = useCompany();
  const [role, setRole] = React.useState(import.meta.env.VITE_DATA_PROVIDER === 'supabase' ? '' : String(user?.role || ''));
  const [checking, setChecking] = React.useState(import.meta.env.VITE_DATA_PROVIDER === 'supabase');
  React.useEffect(() => {
    let cancelled = false;
    if (import.meta.env.VITE_DATA_PROVIDER !== 'supabase') { setRole(String(user?.role || '')); setChecking(false); return undefined; }
    if (!company?.id || !user?.id) return undefined;
    setChecking(true);
    getSupabaseClient().from('company_users').select('role').eq('company_id', company.id).eq('user_id', user.id).eq('active', true).maybeSingle().then(({ data }) => { if (!cancelled) { setRole(data?.role || ''); setChecking(false); } }).catch(() => { if (!cancelled) { setRole(''); setChecking(false); } });
    return () => { cancelled = true; };
  }, [company?.id, user?.id, user?.role]);
  if (checking) return <div className="fixed inset-0 flex items-center justify-center"><div className="h-8 w-8 animate-spin rounded-full border-4 border-slate-200 border-t-slate-800" /></div>;
  return can({ role }, permission) ? children : <Forbidden />;
}

const AuthenticatedApp = () => {
  const { isLoadingAuth, isLoadingPublicSettings, authError, navigateToLogin, isAuthenticated, authChecked } = useAuth();
  const location = useLocation();
  const publicPaths = ['/login', '/register', '/cadastro', '/forgot-password', '/reset-password', '/aceitar-convite'];
  const publicSitePages = {
    '/': 'home',
    '/produtos': 'products',
    '/pro-business': 'pro-business',
    '/planos': 'plans',
    '/politica-de-privacidade': 'privacy',
    '/termos-de-uso': 'terms',
    '/exclusao-de-dados': 'deletion',
    '/contato': 'contact',
  };
  const publicSitePage = publicSitePages[location.pathname];
  if (location.pathname.startsWith('/loja/')) return <Routes><Route path="/loja/:slug" element={<Storefront />} /></Routes>;
  if (publicPaths.includes(location.pathname) || location.pathname.startsWith('/invite/')) return <Routes><Route path="/login" element={<Login />} /><Route path="/register" element={<Register />} /><Route path="/cadastro" element={<Register />} /><Route path="/forgot-password" element={<ForgotPassword />} /><Route path="/reset-password" element={<ResetPassword />} /><Route path="/aceitar-convite" element={<Invite />} /><Route path="/invite/:token" element={<Invite />} /></Routes>;

  // Show loading spinner while checking app public settings or auth
  if (isLoadingPublicSettings || isLoadingAuth) {
    return (
      <div className="fixed inset-0 flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-slate-200 border-t-slate-800 rounded-full animate-spin"></div>
      </div>
    );
  }

  // Public institutional pages do not require an authenticated session. The
  // /produtos path remains the authenticated product module for signed-in users.
  if (publicSitePage && (location.pathname === '/' || !isAuthenticated || location.pathname !== '/produtos')) {
    return <Routes><Route path={location.pathname} element={<PublicSite page={publicSitePage} />} /></Routes>;
  }

  // Handle authentication errors
  if (authError) {
    if (authError.type === 'user_not_registered') {
      return <UserNotRegisteredError />;
    } else if (authError.type === 'auth_required') {
      // Redirect to login automatically
      navigateToLogin();
      return null;
    }
  }

  if (!authChecked || !isAuthenticated) return <Navigate to={`/login?returnTo=${encodeURIComponent(location.pathname + location.search)}`} replace />;

  // Temporary, homologation-only Data API verification route. Remove after
  // authenticated cross-tenant tests; the component hard-fails outside homolog.
  if (location.pathname === '/__tenant-audit') return <Routes><Route path="/__tenant-audit" element={<TenantIsolationAuditTemporary />} /></Routes>;

  if (location.pathname === '/administracao-f7' || location.pathname.startsWith('/administracao-f7/')) {
    return <Routes><Route path="/administracao-f7" element={<PlatformAdmin />} /><Route path="/administracao-f7/empresas/:companyId" element={<PlatformAdmin />} /></Routes>;
  }

  // Render the main app
  return (
    <Routes>
      <Route element={<Layout />}>
          <Route path="/onboarding" element={<Onboarding />} />
          <Route path="/treinamento" element={<RoleGuard permission="dashboard.view"><Academy /></RoleGuard>} />
          <Route path="/treinamento/:moduleId" element={<RoleGuard permission="dashboard.view"><Academy /></RoleGuard>} />
          <Route path="/checkout" element={<Checkout />} />
        <Route path="/invite/:token" element={<Invite />} />
        <Route element={<CompanyGuard />}>
          <Route path="/f7probusiness" element={<RoleGuard permission="dashboard.view"><Dashboard /></RoleGuard>} />
          <Route path="/dashboard" element={<Navigate to="/f7probusiness" replace />} />
          <Route path="/clientes" element={<RoleGuard permission="customers.view"><Clientes /></RoleGuard>} />
          <Route path="/produtos" element={<RoleGuard permission="products.view"><Produtos /></RoleGuard>} />
          <Route path="/producao" element={<RoleGuard permission="production.view"><Producao /></RoleGuard>} />
          <Route path="/estoque" element={<RoleGuard permission="inventory.view"><Estoque /></RoleGuard>} />
          <Route path="/vendas" element={<RoleGuard permission="sales.view"><Vendas /></RoleGuard>} />
          <Route path="/pdv" element={<RoleGuard permission="pdv.use"><PDV /></RoleGuard>} />
          <Route path="/precificacao" element={<RoleGuard permission="pricing.view"><Precificacao /></RoleGuard>} />
          <Route path="/financeiro" element={<RoleGuard permission="finance.view"><Financeiro /></RoleGuard>} />
          <Route path="/configuracoes" element={<RoleGuard permission="settings.view"><Configuracoes /></RoleGuard>} />
          <Route path="/assinatura" element={<RoleGuard permission="settings.view"><SubscriptionBilling /></RoleGuard>} />
          <Route path="/configuracoes/atendimento" element={<RoleGuard permission="assistant_settings.view"><AssistenteConfiguracao /></RoleGuard>} />
          <Route path="/configuracoes/integracoes" element={<RoleGuard permission="settings.view"><Integracoes /></RoleGuard>} />
          <Route path="/usuarios" element={<RoleGuard permission="users.view"><Usuarios /></RoleGuard>} />
          <Route path="/orcamentos" element={<RoleGuard permission="quotes.view"><Orcamentos /></RoleGuard>} />
          <Route path="/compras" element={<RoleGuard permission="purchases.view"><Compras /></RoleGuard>} />
          <Route path="/metas" element={<RoleGuard permission="goals.view"><Metas /></RoleGuard>} />
          <Route path="/atendimento" element={<RoleGuard permission="conversation.view"><Atendimento /></RoleGuard>} />
          <Route path="/automacoes" element={<RoleGuard permission="automation.view"><Automacoes /></RoleGuard>} />
          <Route path="/intelligence" element={<RoleGuard permission="intelligence.view"><Intelligence /></RoleGuard>} />
          <Route path="/opportunities" element={<RoleGuard permission="opportunity.view"><Opportunities /></RoleGuard>} />
          <Route path="/supplier-intelligence" element={<RoleGuard permission="supplier_intelligence.view"><SupplierIntelligence /></RoleGuard>} />
          <Route path="/market-intelligence" element={<RoleGuard permission="market_intelligence.view"><MarketIntelligence /></RoleGuard>} />
          <Route path="/sales-hub" element={<RoleGuard permission="sales_channels.view"><SalesHub /></RoleGuard>} />
          <Route path="/f7-commerce" element={<RoleGuard permission="sales_channels.view"><Commerce /></RoleGuard>} />
          <Route path="/ai-sales" element={<RoleGuard permission="ai_sales.view"><AiSalesAssistant /></RoleGuard>} />
          <Route path="/opportunity-radar" element={<RoleGuard permission="opportunity_radar.view"><OpportunityRadar /></RoleGuard>} />
          <Route path="/ai-observability" element={<RoleGuard permission="ai_observability.view"><AIObservability /></RoleGuard>} />
          <Route path="/relatorios" element={<RoleGuard permission="reports.view"><Relatorios /></RoleGuard>} />
          <Route path="/marketing" element={<RoleGuard permission="reports.view"><Marketing /></RoleGuard>} />
          <Route path="/campanhas" element={<RoleGuard permission="campaigns.view"><Campanhas /></RoleGuard>} />
          <Route path="/notificacoes" element={<RoleGuard permission="notifications.view"><Notificacoes /></RoleGuard>} />
        </Route>
      </Route>
      <Route path="*" element={<PageNotFound />} />
    </Routes>
  );
};


function App() {

  return (
    <ErrorBoundary><AuthProvider>
      <CompanyProvider>
       <QueryClientProvider client={queryClientInstance}>
        <Router>
          <ScrollToTop />
          <AuthenticatedApp />
        </Router>
        <Toaster />
       </QueryClientProvider>
      </CompanyProvider>
    </AuthProvider></ErrorBoundary>
  )
}

export default App
