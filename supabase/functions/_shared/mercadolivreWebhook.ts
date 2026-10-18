const MAX_NOTIFICATION_BYTES = 32_768;

/** Read untrusted webhook JSON with a hard streaming limit, even without Content-Length. */
export async function boundedNotificationPayload(req: Request): Promise<Record<string, unknown> | null> {
  const declared = req.headers.get('content-length');
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > MAX_NOTIFICATION_BYTES)) return null;
  if (!req.body) return {};

  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_NOTIFICATION_BYTES) {
        await reader.cancel('payload_too_large');
        return null;
      }
      chunks.push(value);
    }
  } catch {
    try { await reader.cancel('payload_read_failed'); } catch { /* no further data is retained */ }
    return null;
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  let text: string;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { return null; }
  if (!text.trim()) return {};
  try {
    const value: unknown = JSON.parse(text);
    return value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}
