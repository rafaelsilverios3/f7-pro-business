import { getSupabaseClient } from '@/data/providers/supabaseProvider';

async function invoke(name, body) {
  const { data, error } = await getSupabaseClient().functions.invoke(name, { body });
  if (error) {
    const safeCode = data?.code || error.context?.body?.code || 'COMPANY_PAYMENT_REQUEST_FAILED';
    throw Object.assign(new Error(safeCode), { code: safeCode });
  }
  if (data?.code && data.code !== 'OK') {
    throw Object.assign(new Error(data.code), { code: data.code });
  }
  return data;
}

export const companyPaymentService = {
  status: (companyId) => invoke('mercado-pago-company-status', { company_id: companyId }),
  async connect(companyId) {
    const data = await invoke('mercado-pago-company-connect', { company_id: companyId });
    if (!data.authorization_url) throw new Error('MP_AUTHORIZATION_URL_MISSING');
    return data.authorization_url;
  },
  disconnect: (companyId) => invoke('mercado-pago-company-disconnect', { company_id: companyId }),
  createPayment: (payload) => invoke('mercado-pago-company-payments', payload),
  refreshPayment: (payload) => invoke('mercado-pago-company-payment-status', payload),
  async listForSale(companyId, saleId) {
    const { data, error } = await getSupabaseClient().from('company_mp_payments')
      .select('id,provider_payment_id,provider_preference_id,provider_status,status,method,amount,currency,installments,fee_amount,net_amount,refunded_amount,pix_qr_code,pix_qr_code_base64,pix_ticket_url,checkout_url,expires_at,last_synced_at,created_at')
      .eq('company_id', companyId).eq('sale_id', saleId).order('created_at', { ascending: false }).limit(10);
    if (error) throw error;
    return data || [];
  },
};
