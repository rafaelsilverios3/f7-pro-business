export async function verifyWhatsAppWebhookSignature(signatureHeader: string | null, body: string, secret: string | null | undefined) {
  if (!secret) return false;
  const match = signatureHeader?.match(/^sha256=([0-9a-f]{64})$/i);
  if (!match) return false;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
  const digest = Uint8Array.from(match[1].match(/.{2}/g) || [], (value) => Number.parseInt(value, 16));
  return crypto.subtle.verify('HMAC', key, digest, new TextEncoder().encode(body));
}

export function getWhatsAppWebhookChallenge(url: URL, verifyToken: string | null | undefined) {
  if (!verifyToken || url.searchParams.get('hub.mode') !== 'subscribe' || url.searchParams.get('hub.verify_token') !== verifyToken) return null;
  return url.searchParams.get('hub.challenge') || '';
}
