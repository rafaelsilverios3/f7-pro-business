import base44 from "@base44/vite-plugin"
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'
import { realpathSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = realpathSync.native(path.dirname(fileURLToPath(import.meta.url)))

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, projectRoot, '');
  const isPreview = process.env.VERCEL_ENV === 'preview' || env.VERCEL_ENV === 'preview';
  const supabaseHost = (() => {
    try { return new URL(env.VITE_SUPABASE_URL).hostname.toLowerCase(); } catch { return ''; }
  })();
  const protectedSupabaseRefs = new Set(['izakmtgezocbneilopwr', 'vwylnjmapixtzhryiutt']);
  const previewTargetsProtectedBackend = isPreview && supabaseHost.endsWith('.supabase.co')
    && protectedSupabaseRefs.has(supabaseHost.slice(0, -'.supabase.co'.length));
  if (previewTargetsProtectedBackend) {
    throw new Error('Preview deployments may not target either protected F7 Supabase project.');
  }
  const base44Plugins = env.VITE_DATA_PROVIDER === 'supabase' ? [] : [base44({
      // Support for legacy code that imports the base44 SDK with @/integrations, @/entities, etc.
      // can be removed if the code has been updated to use the new SDK imports from @base44/sdk
      legacySDKImports: process.env.BASE44_LEGACY_SDK_IMPORTS === 'true',
      hmrNotifier: true,
      navigationNotifier: true,
      analyticsTracker: true,
      visualEditAgent: true
    })];
  return {
    // Resolve the app root from this config file instead of process.cwd().
    // Codex's isolated Windows workspaces can expose a virtual cwd that differs
    // from the physical checkout path used by Vite's module resolver.
    root: projectRoot,
    resolve: { alias: { '@': path.resolve(projectRoot, 'src') } },
    plugins: [...base44Plugins, react()],
    define: {
      // These Vercel system variables are public build metadata, not secrets.
      // The homologation-only route requires both the Preview environment and
      // its explicitly authorized Git branch; local/non-Vercel builds fail closed.
      'import.meta.env.VERCEL_ENV': JSON.stringify(process.env.VERCEL_ENV || ''),
      'import.meta.env.VERCEL_GIT_COMMIT_REF': JSON.stringify(process.env.VERCEL_GIT_COMMIT_REF || ''),
    },
  };
});
