import { getSupabaseClient } from '@/data/providers/supabaseProvider';
const readable = (error) => { if (!error) return null; if (/invalid login/i.test(error.message)) return new Error('E-mail ou senha inválidos.'); if (/email not confirmed/i.test(error.message)) return new Error('Confirme seu e-mail antes de entrar.'); return new Error(error.message || 'Falha na autenticação.'); };
export const supabaseAuthProvider = {
  async getSession() { const { data, error } = await getSupabaseClient().auth.getSession(); if (error) throw readable(error); return { user: data.session?.user || null, session: data.session || null }; },
  onAuthStateChange(callback) { return getSupabaseClient().auth.onAuthStateChange((event, session) => callback(event, { user: session?.user || null, session })); },
  async signIn(email, password) { const { data, error } = await getSupabaseClient().auth.signInWithPassword({ email, password }); if (error) throw readable(error); return data; },
  async signUp(email, password) { const { data, error } = await getSupabaseClient().auth.signUp({ email, password }); if (error) throw readable(error); return data; },
  async signOut() { const { error } = await getSupabaseClient().auth.signOut(); if (error) throw readable(error); },
  async resetPassword(email) { const { error } = await getSupabaseClient().auth.resetPasswordForEmail(email); if (error) throw readable(error); },
  async signInWithProvider(provider, redirectTo) { const { error } = await getSupabaseClient().auth.signInWithOAuth({ provider, options: { redirectTo } }); if (error) throw readable(error); },
  async updatePassword(password) { const { error } = await getSupabaseClient().auth.updateUser({ password }); if (error) throw readable(error); },
};
