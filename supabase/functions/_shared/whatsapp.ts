const DEFAULT_GRAPH_VERSION = 'v20.0';

export function graphVersionLabel() {
  const configured = Deno.env.get('WHATSAPP_GRAPH_VERSION')?.trim();
  return configured || `${DEFAULT_GRAPH_VERSION} (fallback)`;
}

function redactSensitiveText(value: unknown, secret?: string) {
  let text = String(value || '');
  if (secret) text = text.split(secret).join('[REDACTED]');
  return text
    .replace(/Bearer\s+[^\s"']+/gi, 'Bearer [REDACTED]')
    .replace(/(access[_-]?token|app[_-]?secret|verify[_-]?token|authorization)\s*[:=]\s*[^,\s}\]]+/gi, '$1=[REDACTED]')
    .slice(0, 280);
}

export function sanitizeMetaError(data: unknown, secret = Deno.env.get('WHATSAPP_ACCESS_TOKEN')) {
  const error = data && typeof data === 'object' && 'error' in data ? (data as { error?: Record<string, unknown> }).error : undefined;
  if (!error || typeof error !== 'object') return null;
  const result: Record<string, unknown> = {};
  if (typeof error.type === 'string') result.type = redactSensitiveText(error.type, secret);
  if (typeof error.code === 'number' || typeof error.code === 'string') result.code = error.code;
  if (typeof error.error_subcode === 'number' || typeof error.error_subcode === 'string') result.subcode = error.error_subcode;
  if (typeof error.fbtrace_id === 'string') result.trace_id = redactSensitiveText(error.fbtrace_id, secret);
  if (typeof error.message === 'string') result.message = redactSensitiveText(error.message, secret);
  return Object.keys(result).length ? result : null;
}

export async function graphRequest(path: string, init: RequestInit = {}) {
  const token = Deno.env.get('WHATSAPP_ACCESS_TOKEN');
  const graph_version = graphVersionLabel();
  if (!token) return { ok: false, status: 503, data: null, code: 'PROVIDER_NOT_CONFIGURED', meta_error: null, graph_version };
  const versionPath = graph_version.replace(/ \(fallback\)$/, '');
  const url = `https://graph.facebook.com/${versionPath}/${path.replace(/^\//, '')}`;
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${token}`);
  headers.set('Content-Type', 'application/json');
  const response = await fetch(url, { method: init.method || 'GET', ...init, headers });
  const data = await response.json().catch(() => null);
  return { ok: response.ok, status: response.status, data, code: response.ok ? null : 'PROVIDER_ERROR', meta_error: response.ok ? null : sanitizeMetaError(data, token), graph_version };
}

export function publicProviderError(result: { status?: number; meta_error?: Record<string, unknown> | null; graph_version?: string }) {
  return { code: 'PROVIDER_ERROR', provider_status: result.status && result.status >= 500 ? 'unavailable' : 'rejected', meta: result.meta_error || undefined, graph_version: result.graph_version };
}

export function phoneValidation(data: any, requestedId: string) {
  const id = String(data?.id || '');
  return Boolean(id && id === requestedId);
}
