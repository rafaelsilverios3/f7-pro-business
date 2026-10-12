import base44 from "@base44/vite-plugin"
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
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
    resolve: { alias: { '@': path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'src') } },
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
