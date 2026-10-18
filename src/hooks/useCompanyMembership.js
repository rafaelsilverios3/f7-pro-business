import { useCallback, useEffect, useState } from 'react';
import { getSupabaseClient } from '@/data/providers/supabaseProvider';
import { useAuth } from '@/lib/AuthContext';

const EMPTY_MEMBERSHIP = { role: '', active: false, loading: true, error: null, companyId: null };

/**
 * Resolves the current user's membership for exactly one company.
 * Supabase Auth metadata is intentionally not used as the source of role.
 */
export function useCompanyMembership(companyId) {
  const { user } = useAuth();
  const [membership, setMembership] = useState(EMPTY_MEMBERSHIP);
  const [reloadVersion, setReloadVersion] = useState(0);
  const refresh = useCallback(() => setReloadVersion((version) => version + 1), []);

  useEffect(() => {
    let cancelled = false;

    if (import.meta.env.VITE_DATA_PROVIDER !== 'supabase') {
      setMembership({
        role: String(user?.role || '').toLowerCase(),
        active: Boolean(user?.id),
        loading: false,
        error: null,
        companyId: companyId || null,
      });
      return () => { cancelled = true; };
    }

    if (!companyId || !user?.id) {
      setMembership({ ...EMPTY_MEMBERSHIP, loading: Boolean(companyId), companyId: null });
      return () => { cancelled = true; };
    }

    setMembership({ ...EMPTY_MEMBERSHIP, companyId });
    Promise.resolve()
      .then(() => getSupabaseClient()
        .from('company_users')
        .select('role, active')
        .eq('company_id', companyId)
        .eq('user_id', user.id)
        .maybeSingle())
      .then(({ data, error }) => {
        if (cancelled) return;
        setMembership({
          role: String(data?.role || '').toLowerCase(),
          active: data?.active === true,
          loading: false,
          error: error || null,
          companyId,
        });
      })
      .catch((error) => {
        if (!cancelled) setMembership({ role: '', active: false, loading: false, error, companyId });
      });

    return () => { cancelled = true; };
  }, [companyId, user?.id, user?.role, reloadVersion]);

  return { ...membership, refresh };
}

