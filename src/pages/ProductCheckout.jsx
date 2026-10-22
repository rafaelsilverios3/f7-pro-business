import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { getSupabaseClient } from '@/data/providers/supabaseProvider';
import { useAuth } from '@/lib/AuthContext';

const labels = { f7_pro_business: 'F7 PRO BUSINESS', f7_food: 'F7 Food' };
const price = (minor) => minor == null ? 'Preço a definir' : new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(minor) / 100);

export default function ProductCheckout() {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const requestedProduct = params.get('product');
  const [products, setProducts] = useState([]);
  const [offers, setOffers] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [proCompanies, setProCompanies] = useState([]);
  const [productKey, setProductKey] = useState('f7_food');
  const [offerId, setOfferId] = useState('');
  const [accountId, setAccountId] = useState('new');
  const [accountName, setAccountName] = useState('');
  const [checkout, setCheckout] = useState(null);
  const [linkCode, setLinkCode] = useState('');
  const [proCompanyId, setProCompanyId] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const checkoutCommand = useRef(null);
  const eligibleOffers = useMemo(() => offers.filter((item) => item.product_key === productKey), [offers, productKey]);

  useEffect(() => {
    let active = true;
    (async () => {
      const supabase = getSupabaseClient();
      const [productResult, offerResult, accountResult, companyResult] = await Promise.all([
        supabase.from('product_catalog').select('product_key,name,description,active').eq('active', true).order('sort_order'),
        supabase.from('product_offers').select('id,product_key,offer_code,name,description,price_minor,currency,billing_period,trial_days,active').eq('active', true).order('product_key'),
        supabase.from('commercial_account_members').select('commercial_account_id,role,commercial_accounts(id,display_name)').eq('user_id', user.id).eq('active', true),
        supabase.from('company_users').select('company_id,companies(name)').eq('user_id', user.id).eq('active', true).eq('role', 'admin'),
      ]);
      const firstError = [productResult, offerResult, accountResult].find((item) => item.error);
      if (firstError) throw firstError.error;
      if (!active) return;
      setProducts(productResult.data || []); setOffers(offerResult.data || []); setAccounts(accountResult.data || []); setProCompanies(companyResult.error ? [] : companyResult.data || []);
      const key = (productResult.data || []).some((item) => item.product_key === requestedProduct) ? requestedProduct : productResult.data?.[0]?.product_key || 'f7_food';
      setProductKey(key);
    })().catch(() => { if (active) setNotice('O catálogo comercial ainda não está instalado no ambiente. O checkout permanece desativado até a migration ser aplicada ao PRO oficial.'); })
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [requestedProduct, user.id]);

  useEffect(() => {
    if (!eligibleOffers.some((item) => item.id === offerId)) setOfferId(eligibleOffers[0]?.id || '');
  }, [eligibleOffers, offerId]);

  async function prepare(event) {
    event.preventDefault(); setBusy(true); setNotice(''); setCheckout(null);
    try {
      const supabase = getSupabaseClient();
      let selectedAccountId = accountId;
      if (accountId === 'new') {
        if (accountName.trim().length < 2) throw new Error('ACCOUNT_NAME_REQUIRED');
        const { data, error } = await supabase.rpc('create_commercial_account', { account_name: accountName.trim() });
        if (error) throw error;
        selectedAccountId = data;
        setAccountId(selectedAccountId);
      }
      if (checkoutCommand.current?.account_id !== selectedAccountId || checkoutCommand.current?.offer_id !== offerId) {
        checkoutCommand.current = { account_id: selectedAccountId, offer_id: offerId, idempotency_key: crypto.randomUUID() };
      }
      const { data, error } = await supabase.functions.invoke('product-checkout', { body: { commercial_account_id: selectedAccountId, offer_id: offerId, idempotency_key: checkoutCommand.current.idempotency_key } });
      if (error) throw error;
      setCheckout({ ...data, id: data.checkout_id, amount_minor: eligibleOffers.find((item) => item.id === offerId)?.price_minor }); setAccountId(selectedAccountId); setParams({ product: productKey }, { replace: true });
      setNotice(data.checkout_url ? 'Checkout sandbox disponível. Nenhuma cobrança real foi habilitada.' : `Intenção preparada. ${data.reason === 'SANDBOX_CHECKOUT_NOT_ENABLED' ? 'O sandbox ainda está desativado.' : 'Nenhuma cobrança foi iniciada.'}`);
    } catch (error) {
      setNotice(error.message === 'ACCOUNT_NAME_REQUIRED' ? 'Informe o nome da conta comercial.' : 'Não foi possível preparar a contratação. Confirme a conta e o plano selecionados.');
    } finally { setBusy(false); }
  }

  async function createLinkCode() {
    setBusy(true); setNotice(''); setLinkCode('');
    try {
      const supabase = getSupabaseClient();
      if (!proCompanyId) throw new Error('PRO_COMPANY_REQUIRED');
      const { data, error } = await supabase.functions.invoke('product-tenant-link', { body: { action: 'start', commercial_account_id: accountId, pro_company_id: proCompanyId } });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setLinkCode(data.one_time_code || '');
      setNotice('Código de uso único criado. O administrador autenticado do Food deve confirmá-lo em até 15 minutos.');
    } catch {
      setNotice('Não foi possível iniciar o vínculo. Confirme que você é administrador da conta comercial e, se selecionada, da empresa PRO.');
    } finally { setBusy(false); }
  }

  return <main className="min-h-[70vh] bg-slate-50 px-5 py-12"><div className="mx-auto max-w-3xl space-y-6"><header><p className="text-xs font-semibold uppercase tracking-[.2em] text-blue-600">Ecossistema F7 · contratação independente</p><h1 className="mt-2 text-3xl font-semibold text-slate-900">Escolha produto e plano</h1><p className="mt-2 text-sm text-slate-600">Você pode criar uma conta comercial sem abrir uma empresa operacional no F7 PRO.</p></header>
    {notice && <div role="status" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">{notice}</div>}
    {loading ? <p className="rounded-xl bg-white p-6 text-sm text-slate-500">Carregando catálogo…</p> : <form onSubmit={prepare} className="grid gap-5 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <label className="grid gap-2 text-sm font-semibold">Produto<select required value={productKey} onChange={(event)=>setProductKey(event.target.value)} className="rounded-lg border border-slate-300 p-3">{products.map((item)=><option key={item.product_key} value={item.product_key}>{item.name}</option>)}</select></label>
      <label className="grid gap-2 text-sm font-semibold">Plano<select required value={offerId} onChange={(event)=>setOfferId(event.target.value)} className="rounded-lg border border-slate-300 p-3">{eligibleOffers.map((item)=><option key={item.id} value={item.id}>{item.name} · {price(item.price_minor)} · {item.billing_period==='year'?'anual':item.billing_period==='month'?'mensal':'sem cobrança'}</option>)}</select></label>
      {eligibleOffers.find((item)=>item.id===offerId)&&<p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-600">{eligibleOffers.find((item)=>item.id===offerId)?.description || `${eligibleOffers.find((item)=>item.id===offerId)?.trial_days || 0} dias de avaliação configuráveis.`}</p>}
      <label className="grid gap-2 text-sm font-semibold">Conta comercial<select value={accountId} onChange={(event)=>setAccountId(event.target.value)} className="rounded-lg border border-slate-300 p-3"><option value="new">Criar nova conta comercial</option>{accounts.map((item)=><option key={item.commercial_account_id} value={item.commercial_account_id}>{item.commercial_accounts?.display_name || 'Conta existente'} · {item.role}</option>)}</select></label>
      {accountId==='new'&&<label className="grid gap-2 text-sm font-semibold">Nome comercial<input required minLength={2} maxLength={120} value={accountName} onChange={(event)=>setAccountName(event.target.value)} placeholder="Ex.: Restaurante da Praça" className="rounded-lg border border-slate-300 p-3" /></label>}
      <button type="submit" disabled={busy||!offerId} className="rounded-xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white disabled:opacity-50">{busy?'Preparando…':'Preparar contratação'}</button>
    </form>}
    {checkout&&<section className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5"><p className="font-semibold text-emerald-900">Etapa comercial preparada</p><p className="mt-2 text-sm text-emerald-800">{labels[productKey]} · {price(checkout.amount_minor)} · situação {checkout.status}. Cobrança ainda não iniciada.</p><p className="mt-2 break-all font-mono text-xs text-emerald-700">Referência {checkout.id}</p></section>}
    {checkout?.checkout_url&&<a href={checkout.checkout_url} target="_blank" rel="noreferrer" className="inline-flex rounded-xl bg-emerald-700 px-5 py-3 text-sm font-semibold text-white">Abrir checkout de teste</a>}
    {productKey==='f7_food'&&accountId!=='new'&&['owner','admin'].includes(accounts.find((item)=>item.commercial_account_id===accountId)?.role)&&<section className="grid gap-4 rounded-2xl border border-slate-200 bg-white p-5"><div><h2 className="font-semibold text-slate-900">Vincular F7 PRO ao Food (opcional)</h2><p className="mt-1 text-sm text-slate-600">O vínculo é opcional para usar o Food. Para criar um, selecione uma empresa PRO que você administra; um administrador Food deverá confirmar em até 15 minutos. Não usamos e-mail ou nome como comprovação.</p></div>{proCompanies.length>0?<><label className="grid gap-2 text-sm font-semibold">Empresa operacional do PRO<select value={proCompanyId} onChange={(event)=>setProCompanyId(event.target.value)} className="rounded-lg border border-slate-300 p-3"><option value="">Selecione uma empresa PRO</option>{proCompanies.map((item)=><option key={item.company_id} value={item.company_id}>{item.companies?.name || item.company_id}</option>)}</select></label><button type="button" disabled={busy||!proCompanyId} onClick={createLinkCode} className="w-fit rounded-xl border border-blue-200 px-4 py-3 text-sm font-semibold text-blue-700 disabled:opacity-50">Gerar código temporário</button></>:<p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-600">Nenhuma empresa PRO administrada por esta conta. Você pode contratar e operar o F7 Food de forma independente.</p>}{linkCode&&<div className="rounded-xl bg-slate-50 p-4"><p className="text-xs font-semibold text-slate-600">Código para colar em F7 Food · expira em 15 minutos · uso único</p><code className="mt-2 block break-all select-all text-sm text-slate-900">{linkCode}</code></div>}</section>}
    <p className="text-xs leading-relaxed text-slate-500">A licença só será liberada depois de uma confirmação confiável de pagamento. Até a homologação do checkout, este fluxo registra apenas a intenção e não inicia cobranças.</p><Link to="/sistemas" className="inline-flex text-sm font-semibold text-blue-700">← Voltar aos Sistemas F7</Link>
  </div></main>;
}
