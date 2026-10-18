import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { getDataProvider } from '@/data/providerSelector';
import { useAuth } from '@/lib/AuthContext';

const CompanyContext = createContext(null);

export function CompanyProvider({ children }) {
  const { isAuthenticated, authChecked, user } = useAuth();
  const [company, setCompany] = useState(null);
  const [companies, setCompanies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const createCompanyInFlight = useRef(null);
  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const list = await getDataProvider().entity('Company').list();
      setCompanies(list || []);
      const stored = localStorage.getItem('f7_company_id');
      const active = (list || []).find((item) => item.id === stored) || list?.[0] || null;
      if (active) localStorage.setItem('f7_company_id', active.id);
      setCompany(active);
    } catch (cause) { setError(cause); setCompany(null); }
    finally { setLoading(false); }
  }, []);
  // Do not query companies before authentication is resolved. More
  // importantly, reload after OAuth/password sign-in: the provider is mounted
  // before the session exists, so a one-time load would otherwise leave a new
  // session stuck with the unauthenticated empty result.
  useEffect(() => {
    if (!authChecked) return;
    if (!isAuthenticated || !user?.id) { setCompany(null); setCompanies([]); setLoading(false); return; }
    load();
  }, [authChecked, isAuthenticated, user?.id, load]);
  const createCompany = useCallback((name) => {
    if (createCompanyInFlight.current) return createCompanyInFlight.current;
    const pending = (async () => {
      const result = await getDataProvider().rpc('create_company_with_owner', { company_name: name });
      const created = Array.isArray(result) ? result[0] : result;
      if (!created?.id) throw new Error('Não foi possível confirmar a empresa criada.');
      localStorage.setItem('f7_company_id', created.id);
      await load();
      // The RPC is idempotent per authenticated user and returns the existing
      // active company on retry. Keep that authoritative row selected even if
      // the follow-up list request temporarily fails.
      setCompanies((current) => current.some((item) => item.id === created.id)
        ? current
        : [...current, created]);
      setCompany(created);
      return created;
    })();
    createCompanyInFlight.current = pending;
    return pending.finally(() => { createCompanyInFlight.current = null; });
  }, [load]);
  const value = useMemo(() => ({ company, companyId: company?.id || null, companies, loading, error, switchCompany: (next) => { localStorage.setItem('f7_company_id', next.id); setCompany(next); }, createCompany, refresh: load }), [company, companies, loading, error, load, createCompany]);
  return <CompanyContext.Provider value={value}>{children}</CompanyContext.Provider>;
}

export function useCompany() {
  const context = useContext(CompanyContext);
  if (!context) throw new Error('useCompany must be used within CompanyProvider');
  return context;
}
