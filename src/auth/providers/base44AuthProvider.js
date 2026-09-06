import { base44 } from '@/api/base44Client';
export const base44AuthProvider = {
  async getSession() { try { return { user: await base44.auth.me(), session: null }; } catch { return { user: null, session: null }; } },
  onAuthStateChange() { return { data: { subscription: { unsubscribe() {} } } }; },
  signIn: (email, password) => base44.auth.loginViaEmailPassword(email, password),
  signUp: (email, password) => base44.auth.register({ email, password }),
  signOut: () => base44.auth.logout(),
  resetPassword: (email) => base44.auth.resetPasswordRequest(email),
  signInWithProvider: (provider, redirectTo) => base44.auth.loginWithProvider(provider, redirectTo),
  updatePassword: ({ resetToken, newPassword }) => base44.auth.resetPassword({ resetToken, newPassword }),
};
