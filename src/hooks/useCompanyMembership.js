import { useEffect, useState } from 'react';
import { getSupabaseClient } from '@/data/providers/supabaseProvider';
import { useAuth } from '@/lib/AuthContext';

const EMPTY_MEMBERSHIP = { role: '', active: false, loading: true, error: null };

/**
 * Resolves the current user's membership for exactly one company.
 * Supabase Auth metadata is intentionally not used as the source of role.
 */
export function useCompanyMembership(companyId) {
  const { user } = useAuth();
  const [membership, setMembership] = useState(EMPTY_MEMBERSHIP);

  useEffect(() => {
    let cancelled = false;

    if (import.meta.env.VITE_DATA_PROVIDER !== 'supabase') {
      setMembership({
        role: String(user?.role || '').toLowerCase(),
        active: Boolean(user?.id),
        loading: false,
        error: null,
      });
      return () => { cancelled = true; };
    }

    if (!companyId || !user?.id) {
      setMembership({ ...EMPTY_MEMBERSHIP, loading: Boolean(companyId) });
      return () => { cancelled = true; };
    }

    setMembership(EMPTY_MEMBERSHIP);
    getSupabaseClient()
      .from('company_users')
      .select('role, active')
      .eq('company_id', companyId)
      .eq('user_id', user.id)
      .maybeSingle()
      .then(({ data, error }) => {
        if (cancelled) return;
        setMembership({
          role: String(data?.role || '').toLowerCase(),
          active: data?.active === true,
          loading: false,
          error: error || null,
        });
      })
      .catch((error) => {
        if (!cancelled) setMembership({ role: '', active: false, loading: false, error });
      });

    return () => { cancelled = true; };
  }, [companyId, user?.id, user?.role]);

  return membership;
}

