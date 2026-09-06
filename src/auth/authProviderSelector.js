import { base44AuthProvider } from './providers/base44AuthProvider';
import { supabaseAuthProvider } from './providers/supabaseAuthProvider';
export const getAuthProvider = () => import.meta.env.VITE_DATA_PROVIDER === 'supabase' ? supabaseAuthProvider : base44AuthProvider;
