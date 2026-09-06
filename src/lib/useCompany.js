// F7 PRO BUSINESS — Hook de empresa ativa
import { useState, useEffect, useCallback } from 'react';
import { base44 } from '@/api/base44Client';

export function useCompany() {
  const [company, setCompany] = useState(null);
  const [companies, setCompanies] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const list = await base44.entities.Company.list();
    setCompanies(list);
    if (list.length === 0) { setLoading(false); return; }
    const stored = localStorage.getItem('f7_company_id');
    const active = list.find((c) => c.id === stored) || list[0];
    localStorage.setItem('f7_company_id', active.id);
    setCompany(active);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const switchCompany = useCallback((c) => {
    localStorage.setItem('f7_company_id', c.id);
    setCompany(c);
  }, []);

  const refresh = useCallback(() => load(), [load]);

  return { company, companies, loading, switchCompany, refresh };
}