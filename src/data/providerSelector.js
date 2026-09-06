import { base44Provider } from './providers/base44Provider';
import { supabaseProvider } from './providers/supabaseProvider';

export function getDataProvider() {
  return import.meta.env.VITE_DATA_PROVIDER === 'supabase' ? supabaseProvider : base44Provider;
}
