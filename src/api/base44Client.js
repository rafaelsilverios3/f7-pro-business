import { createClient } from '@base44/sdk';
import { appParams } from '@/lib/app-params';

const { appId, token, functionsVersion, appBaseUrl } = appParams;
const unavailable = () => { throw new Error('Base44 indisponível quando VITE_DATA_PROVIDER=supabase.'); };
const unavailableProxy = new Proxy({}, { get: () => unavailable });

// Do not instantiate the Base44 SDK in Supabase mode: SDK construction starts
// its analytics processor even when no Base44 entity is used by the page.
/** @type {any} */
const client = import.meta.env.VITE_DATA_PROVIDER === 'supabase'
  ? { entities: new Proxy({}, { get: () => unavailableProxy }), auth: unavailableProxy, app: unavailableProxy, functions: unavailableProxy }
  : createClient({ appId, token, functionsVersion, serverUrl: '', appBaseUrl });
export const base44 = client;
