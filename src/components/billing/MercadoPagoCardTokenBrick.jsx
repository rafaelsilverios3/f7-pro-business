import React from 'react';

let sdkPromise;
function loadMercadoPagoSdk() {
  if (window.MercadoPago) return Promise.resolve();
  if (sdkPromise) return sdkPromise;
  sdkPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector('script[data-mercadopago-sdk]');
    const script = existing || document.createElement('script');
    script.src = 'https://sdk.mercadopago.com/js/v2';
    script.async = true;
    script.dataset.mercadopagoSdk = 'true';
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('CARD_SDK_UNAVAILABLE'));
    if (!existing) document.head.appendChild(script);
  }).catch((error) => { sdkPromise = undefined; throw error; });
  return sdkPromise;
}

/**
 * Mercado Pago's hosted Card Payment Brick owns the card fields and creates a
 * one-use card token. Raw PAN/CVV never enter F7 React state or our API.
 */
export default function MercadoPagoCardTokenBrick({ amountMinor, email, onToken, onError }) {
  const containerId = React.useId().replaceAll(':', '');
  const [state, setState] = React.useState('loading');
  const publicKey = String(import.meta.env.VITE_MERCADO_PAGO_PUBLIC_KEY || '').trim();

  React.useEffect(() => {
    let disposed = false;
    let controller;
    if (!publicKey) { setState('unconfigured'); return undefined; }
    loadMercadoPagoSdk().then(async () => {
      if (disposed) return;
      const mp = new window.MercadoPago(publicKey, { locale: 'pt-BR' });
      controller = await mp.bricks().create('cardPayment', containerId, {
        initialization: { amount: Number(amountMinor) / 100, payer: email ? { email } : undefined },
        callbacks: {
          onReady: () => { if (!disposed) setState('ready'); },
          onSubmit: async (formData) => {
            const token = typeof formData?.token === 'string' ? formData.token : '';
            if (!token || token.length > 256) throw new Error('CARD_TOKEN_UNAVAILABLE');
            setState('submitting');
            try { await onToken(token); }
            catch (error) { setState('ready'); onError?.(error); throw error; }
          },
          onError: () => { if (!disposed) { setState('error'); onError?.(new Error('CARD_FORM_UNAVAILABLE')); } },
        },
      });
    }).catch((error) => {
      if (!disposed) { setState('error'); onError?.(error); }
    });
    return () => {
      disposed = true;
      if (controller?.unmount) controller.unmount();
    };
  }, [amountMinor, containerId, email, onError, onToken, publicKey]);

  if (state === 'unconfigured') return <p role="status" className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">Checkout com cartão ainda não está configurado neste ambiente.</p>;
  if (state === 'error') return <p role="alert" className="mt-4 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">Não foi possível carregar o formulário seguro de cartão. Tente novamente mais tarde.</p>;
  return <div className="mt-5">
    {state === 'loading' && <p role="status" className="mb-3 text-sm text-slate-500">Carregando formulário seguro…</p>}
    {state === 'submitting' && <p role="status" className="mb-3 text-sm text-slate-500">Enviando token seguro para criar a assinatura…</p>}
    <div id={containerId} aria-label="Formulário seguro de cartão Mercado Pago" />
  </div>;
}
