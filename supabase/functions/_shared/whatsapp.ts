const graphVersion = () => Deno.env.get('WHATSAPP_GRAPH_VERSION') || 'v20.0';

export async function graphRequest(path: string, init: RequestInit = {}) {
  const token = Deno.env.get('WHATSAPP_ACCESS_TOKEN');
  if (!token) return { ok: false, status: 503, data: null, code: 'PROVIDER_NOT_CONFIGURED' };
  const url = `https://graph.facebook.com/${graphVersion()}/${path.replace(/^\//, '')}`;
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${token}`);
  headers.set('Content-Type', 'application/json');
  const response = await fetch(url, { ...init, headers });
  const data = await response.json().catch(() => null);
  return { ok: response.ok, status: response.status, data, code: response.ok ? null : 'PROVIDER_ERROR' };
}

export function publicProviderError(result: { status?: number; data?: any }) {
  return { code: 'PROVIDER_ERROR', provider_status: result.status && result.status >= 500 ? 'unavailable' : 'rejected' };
}

export function phoneValidation(data: any, requestedId: string) {
  const id = String(data?.id || '');
  return Boolean(id && id === requestedId);
}
