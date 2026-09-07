import { Toaster } from "@/components/ui/toaster"
import React from 'react';
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClientInstance } from '@/lib/query-client'
import { BrowserRouter as Router, Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';
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
import Integracoes from './pages/Integracoes.jsx';
import Orcamentos from './pages/Orcamentos.jsx';
import Compras from './pages/Compras.jsx';
import Metas from './pages/Metas.jsx';
import Atendimento from './pages/Atendimento.jsx';
import Automacoes from './pages/Automacoes.jsx';
import Intelligence from './pages/Intelligence.jsx';
import Relatorios from './pages/Relatorios.jsx';
import Notificacoes from './pages/Notificacoes.jsx';
import Onboarding from './pages/Onboarding.jsx';
import Usuarios from './pages/Usuarios.jsx';
import PDV from './pages/PDV.jsx';
import Precificacao from './pages/Precificacao.jsx';
import Storefront from './pages/Storefront.jsx';
import Opportunities from './pages/Opportunities.jsx';
import SupplierIntelligence from './pages/SupplierIntelligence.jsx';
import MarketIntelligence from './pages/MarketIntelligence.jsx';
import Login from './pages/Login.jsx';
import Register from './pages/Register.jsx';
import ForgotPassword from './pages/ForgotPassword.jsx';
import ResetPassword from './pages/ResetPassword.jsx';
import Invite from './pages/Invite.jsx';
import ErrorBoundary from '@/components/ErrorBoundary';
import { useCompany } from '@/lib/useCompany';
import { can } from '@/lib/permissions';
import { getSupabaseClient } from '@/data/providers/supabaseProvider';

const CompanyGuard = () => {
  const { company, loading } = useCompany();
  if (loading) return <div className="fixed inset-0 flex items-center justify-center"><div className="h-8 w-8 animate-spin rounded-full border-4 border-slate-200 border-t-slate-800" /></div>;
  return company ? <Outlet context={{ company }} /> : <Navigate to="/onboarding" replace />;
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
  const publicPaths = ['/login', '/register', '/forgot-password', '/reset-password'];
  if (location.pathname.startsWith('/loja/')) return <Routes><Route path="/loja/:slug" element={<Storefront />} /></Routes>;
  if (publicPaths.includes(location.pathname) || location.pathname.startsWith('/invite/')) return <Routes><Route path="/login" element={<Login />} /><Route path="/register" element={<Register />} /><Route path="/forgot-password" element={<ForgotPassword />} /><Route path="/reset-password" element={<ResetPassword />} /><Route path="/invite/:token" element={<Invite />} /></Routes>;

  // Show loading spinner while checking app public settings or auth
  if (isLoadingPublicSettings || isLoadingAuth) {
    return (
      <div className="fixed inset-0 flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-slate-200 border-t-slate-800 rounded-full animate-spin"></div>
      </div>
    );
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

  if (!authChecked || !isAuthenticated) return <Navigate to="/login" replace />;

  // Render the main app
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/onboarding" element={<Onboarding />} />
        <Route path="/invite/:token" element={<Invite />} />
        <Route element={<CompanyGuard />}>
          <Route path="/" element={<RoleGuard permission="dashboard.view"><Dashboard /></RoleGuard>} />
          <Route path="/dashboard" element={<RoleGuard permission="dashboard.view"><Dashboard /></RoleGuard>} />
          <Route path="/clientes" element={<RoleGuard permission="customers.view"><Clientes /></RoleGuard>} />
          <Route path="/produtos" element={<RoleGuard permission="products.view"><Produtos /></RoleGuard>} />
          <Route path="/estoque" element={<RoleGuard permission="inventory.view"><Estoque /></RoleGuard>} />
          <Route path="/vendas" element={<RoleGuard permission="sales.view"><Vendas /></RoleGuard>} />
          <Route path="/pdv" element={<RoleGuard permission="pdv.use"><PDV /></RoleGuard>} />
          <Route path="/precificacao" element={<RoleGuard permission="pricing.view"><Precificacao /></RoleGuard>} />
          <Route path="/financeiro" element={<RoleGuard permission="finance.view"><Financeiro /></RoleGuard>} />
          <Route path="/configuracoes" element={<RoleGuard permission="settings.view"><Configuracoes /></RoleGuard>} />
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
          <Route path="/relatorios" element={<RoleGuard permission="reports.view"><Relatorios /></RoleGuard>} />
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
