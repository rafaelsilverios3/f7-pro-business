import { admin, corsHeaders, json } from '../_shared/core.ts';

const clean = (value: unknown, max = 120) => String(value || '').replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
async function validSignature(req: Request, body: any) {
  const secret = Deno.env.get('MERCADO_PAGO_WEBHOOK_SECRET') || ''; if (!secret) return false;
  const signature = req.headers.get('x-signature') || ''; const requestId = req.headers.get('x-request-id') || ''; const dataId = clean(body?.data?.id || body?.id); const ts = signature.match(/(?:^|,)ts=([^,]+)/)?.[1] || ''; const v1 = signature.match(/(?:^|,)v1=([^,]+)/)?.[1] || ''; if (!ts || !v1 || !dataId) return false;
  if (!Number.isFinite(Number(ts)) || Math.abs(Date.now() - Number(ts)) > 10 * 60 * 1000) return false;
  const message = `id:${dataId};request-id:${requestId};ts:${ts};`; const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']); const digest = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message)); const expected = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join(''); return expected === v1;
}
const mapped = (status: string) => ({ approved: 'approved', pending: 'pending', in_process: 'pending', rejected: 'rejected', cancelled: 'cancelled', refunded: 'refunded', charged_back: 'charged_back' } as Record<string, string>)[status] || 'pending';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ code: 'METHOD_NOT_ALLOWED' }, 405);
  const sb = admin(); const body = await req.json().catch(() => ({})); if (!(await validSignature(req, body))) return json({ code: 'INVALID_WEBHOOK_SIGNATURE' }, 401);
  const eventId = clean(body?.id || body?.data?.id); const type = clean(body?.type || body?.action, 80); const resourceId = clean(body?.data?.id || body?.data?.object_id);
  const inserted = await sb.from('billing_webhook_events').insert({ provider: 'mercado_pago', provider_event_id: eventId, event_type: type, provider_resource_id: resourceId, status: 'received', metadata: { live_mode: Boolean(body?.live_mode) } }); if (inserted.error?.code === '23505') return json({ code: 'OK', duplicate: true }); if (inserted.error) return json({ code: 'WEBHOOK_PERSIST_FAILED' }, 500);
  if (type !== 'payment' || !resourceId) { await sb.from('billing_webhook_events').update({ status: 'ignored', processed_at: new Date().toISOString() }).eq('provider_event_id', eventId); return json({ code: 'OK', ignored: true }); }
  const token = Deno.env.get('MERCADO_PAGO_ACCESS_TOKEN') || ''; if (!token) return json({ code: 'MERCADO_PAGO_NOT_CONFIGURED' }, 503);
  const response = await fetch(`https://api.mercadopago.com/v1/payments/${encodeURIComponent(resourceId)}`, { headers: { Authorization: `Bearer ${token}` } }); const payment = await response.json().catch(() => ({})); if (!response.ok) return json({ code: 'PAYMENT_LOOKUP_FAILED' }, 502);
  const status = mapped(payment.status); const { data: local } = await sb.from('billing_payments').select('id,company_id,metadata').eq('provider', 'mercado_pago').eq('provider_payment_id', resourceId).maybeSingle(); if (!local) { await sb.from('billing_webhook_events').update({ status: 'ignored', processed_at: new Date().toISOString() }).eq('provider_event_id', eventId); return json({ code: 'OK', ignored: true }); }
  const paidAt = status === 'approved' ? new Date().toISOString() : null; await sb.from('billing_payments').update({ provider_status: payment.status || null, status, paid_at: paidAt, updated_at: new Date().toISOString() }).eq('id', local.id).eq('company_id', local.company_id);
  const checkoutId = local.metadata?.checkout_id; const { data: checkout } = checkoutId ? await sb.from('billing_checkout_sessions').select('id,plan_id,company_id').eq('id', checkoutId).eq('company_id', local.company_id).maybeSingle() : { data: null };
  if (checkout) { await sb.from('billing_checkout_sessions').update({ status: status === 'approved' ? 'approved' : status === 'pending' ? 'pending' : 'failed', updated_at: new Date().toISOString() }).eq('id', checkout.id); if (status === 'approved') { const { data: plan } = await sb.from('plans').select('code,trial_days').eq('id', checkout.plan_id).maybeSingle(); if (plan) await sb.from('company_subscriptions').upsert({ company_id: checkout.company_id, plan: plan.code, status: 'active', current_period_start: new Date().toISOString(), current_period_end: new Date(Date.now() + 30 * 86_400_000).toISOString(), updated_at: new Date().toISOString() }, { onConflict: 'company_id' }); await sb.from('audit_logs').insert({ company_id: checkout.company_id, action: 'billing.subscription_activated', entity: 'company_subscriptions', entity_id: checkout.company_id, new_data: { plan: plan?.code || null, payment_id: resourceId } }); } }
  await sb.from('billing_webhook_events').update({ status: 'processed', processed_at: new Date().toISOString() }).eq('provider_event_id', eventId); return json({ code: 'OK', status });
});
