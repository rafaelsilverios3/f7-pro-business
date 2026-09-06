import { Toaster } from "@/components/ui/toaster"
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
import Login from './pages/Login.jsx';
import Register from './pages/Register.jsx';
import ForgotPassword from './pages/ForgotPassword.jsx';
import ResetPassword from './pages/ResetPassword.jsx';
import { useCompany } from '@/lib/useCompany';

const CompanyGuard = () => {
  const { company, loading } = useCompany();
  if (loading) return <div className="fixed inset-0 flex items-center justify-center"><div className="h-8 w-8 animate-spin rounded-full border-4 border-slate-200 border-t-slate-800" /></div>;
  return company ? <Outlet /> : <Navigate to="/onboarding" replace />;
};

const AuthenticatedApp = () => {
  const { isLoadingAuth, isLoadingPublicSettings, authError, navigateToLogin, isAuthenticated, authChecked } = useAuth();
  const location = useLocation();
  const publicPaths = ['/login', '/register', '/forgot-password', '/reset-password'];
  if (publicPaths.includes(location.pathname)) return <Routes><Route path="/login" element={<Login />} /><Route path="/register" element={<Register />} /><Route path="/forgot-password" element={<ForgotPassword />} /><Route path="/reset-password" element={<ResetPassword />} /></Routes>;

  // Show loading spinner while checking app public settings or auth
  if (isLoadingPublicSettings || isLoadingAuth) {
    return (
      <div className="fixed inset-0 flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-slate-200 border-t-slate-800 rounded-full animate-spin"></div>
      </div>
    );
  }

  if (!authChecked || !isAuthenticated) return <Navigate to="/login" replace />;

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

  // Render the main app
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/onboarding" element={<Onboarding />} />
        <Route element={<CompanyGuard />}>
          <Route path="/" element={<Dashboard />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/clientes" element={<Clientes />} />
          <Route path="/produtos" element={<Produtos />} />
          <Route path="/estoque" element={<Estoque />} />
          <Route path="/vendas" element={<Vendas />} />
          <Route path="/financeiro" element={<Financeiro />} />
          <Route path="/configuracoes" element={<Configuracoes />} />
          <Route path="/usuarios" element={<Usuarios />} />
          <Route path="/orcamentos" element={<Orcamentos />} />
          <Route path="/compras" element={<Compras />} />
          <Route path="/metas" element={<Metas />} />
          <Route path="/atendimento" element={<Atendimento />} />
          <Route path="/automacoes" element={<Automacoes />} />
          <Route path="/intelligence" element={<Intelligence />} />
          <Route path="/relatorios" element={<Relatorios />} />
          <Route path="/notificacoes" element={<Notificacoes />} />
        </Route>
      </Route>
      <Route path="*" element={<PageNotFound />} />
    </Routes>
  );
};


function App() {

  return (
    <AuthProvider>
      <CompanyProvider>
       <QueryClientProvider client={queryClientInstance}>
        <Router>
          <ScrollToTop />
          <AuthenticatedApp />
        </Router>
        <Toaster />
       </QueryClientProvider>
      </CompanyProvider>
    </AuthProvider>
  )
}

export default App
