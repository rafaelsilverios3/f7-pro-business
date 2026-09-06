import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { getDataProvider } from '@/data/providerSelector';

const CompanyContext = createContext(null);

export function CompanyProvider({ children }) {
  const [company, setCompany] = useState(null);
  const [companies, setCompanies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
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
  useEffect(() => { load(); }, [load]);
  const createCompany = useCallback(async (name) => { const created = await getDataProvider().rpc('create_company_with_owner', { company_name: name }); await load(); return created; }, [load]);
  const value = useMemo(() => ({ company, companyId: company?.id || null, companies, loading, error, switchCompany: (next) => { localStorage.setItem('f7_company_id', next.id); setCompany(next); }, createCompany, refresh: load }), [company, companies, loading, error, load, createCompany]);
  return <CompanyContext.Provider value={value}>{children}</CompanyContext.Provider>;
}

export function useCompany() {
  const context = useContext(CompanyContext);
  if (!context) throw new Error('useCompany must be used within CompanyProvider');
  return context;
}
