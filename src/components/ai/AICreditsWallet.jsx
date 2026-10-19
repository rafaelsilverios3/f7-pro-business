import React, { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Coins, RefreshCw } from 'lucide-react';
import { aiCreditsService } from '@/services/aiCreditsService';
import { billingService } from '@/services/billingService';
import MercadoPagoCardTokenBrick from '@/components/billing/MercadoPagoCardTokenBrick';
import { useCompanyMembership } from '@/hooks/useCompanyMembership';

const price = (minor) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(minor || 0) / 100);

export default function AICreditsWallet({ companyId, email, refreshKey = 0 }) {
  const membership = useCompanyMembership(companyId);
  const [snapshot, setSnapshot] = useState(null); const [selected, setSelected] = useState(null); const [method, setMethod] = useState('pix'); const [payment, setPayment] = useState(null); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const load = useCallback(async () => { if (!companyId || import.meta.env.VITE_DATA_PROVIDER !== 'supabase') return; try { setSnapshot(await aiCreditsService.snapshot(companyId)); setError(''); } catch { setSnapshot(null); setError('Saldo de F7 AI Credits indisponível.'); } }, [companyId]);
  useEffect(() => { load(); }, [load, refreshKey]);
  const canPurchase = membership.active && ['admin', 'gestor'].includes(membership.role);
  const startPix = async (pkg) => {
    if (!canPurchase) return;
    if (!window.confirm(`Confirmar compra avulsa de ${Number(pkg.credits).toLocaleString('pt-BR')} créditos por ${price(pkg.price_minor)}? Pagamento único, sem renovação automática.`)) return;
    const purchase = { ...pkg, requestId: crypto.randomUUID() };
    setSelected(purchase); setMethod('pix'); setBusy(true); setError(''); setPayment(null);
    try { const result = await billingService.createAiCreditPackageCheckout(companyId, pkg.package_code, 'pix', undefined, purchase.requestId); setPayment(result); }
    catch (cause) { setError(cause.message || 'Checkout de créditos indisponível.'); }
    finally { setBusy(false); }
  };
  const submitCard = useCallback(async (cardPayment) => {
    if (!selected || !canPurchase || !window.confirm(`Confirmar pagamento único de ${price(selected.price_minor)} por ${Number(selected.credits).toLocaleString('pt-BR')} créditos?`)) throw new Error('COMPRA_CANCELADA');
    setBusy(true); setError('');
    try { setPayment(await billingService.createAiCreditPackageCheckout(companyId, selected.package_code, 'card', cardPayment, selected.requestId)); }
    catch (cause) { setError(cause.message || 'Pagamento do pacote indisponível.'); throw cause; }
    finally { setBusy(false); }
  }, [companyId, selected]);
  const wallet = snapshot || {}; const ownerUsage = wallet.owner_usage?.owner_exempt === true ? wallet.owner_usage : null;
  const ownerPolicy = ownerUsage?.policy || {}; const ownerDailyUsage = ownerUsage?.usage || {};
  const usedPercent = Number(wallet.monthly_allowance) > 0 ? Math.min(100, Math.floor(Number(wallet.used_this_cycle || 0) / Number(wallet.monthly_allowance) * 100)) : 0;
  return <section className="mb-5 rounded-2xl border border-indigo-200 bg-white p-4 shadow-sm sm:p-5">
    <div className="flex flex-wrap items-start justify-between gap-3"><div className="flex items-center gap-2"><Coins className="h-5 w-5 text-indigo-600"/><div><h3 className="font-semibold text-slate-900">F7 AI Credits</h3><p className="text-xs text-slate-500">Créditos de uso de IA da empresa atual · não são dinheiro sacável.</p></div></div><button type="button" onClick={load} className="inline-flex items-center gap-1 text-xs font-semibold text-indigo-700"><RefreshCw className="h-3.5 w-3.5"/> Atualizar</button></div>
    {error && <p role="alert" className="mt-3 rounded-lg bg-rose-50 p-2 text-xs text-rose-700">{error}</p>}
    {ownerUsage && <div className="mt-4 rounded-xl border border-violet-200 bg-violet-50/50 p-4"><h4 className="font-semibold text-violet-950">Owner Global · isento de créditos comerciais</h4><p className="mt-1 text-xs text-slate-600">Seu uso é autorizado pelo papel global validado no servidor e medido separadamente da franquia da empresa. A isenção não se estende a outros usuários da empresa.</p><div className="mt-3 grid gap-2 sm:grid-cols-4"><Metric label="Chamadas hoje (UTC)" value={`${ownerDailyUsage.calls ?? 0}${ownerPolicy.temporary_limits_enabled ? ` / ${ownerPolicy.daily_call_limit ?? 5}` : ''}`} /><Metric label="Custo real liquidado" value={`R$ ${Number(ownerDailyUsage.actual_cost_brl ?? 0).toFixed(4)}`} /><Metric label="Reservas protegidas" value={`R$ ${Number(ownerDailyUsage.reserved_brl || 0).toFixed(4)}`} /><Metric label="Tokens medidos" value={Number(ownerDailyUsage.tokens || 0).toLocaleString('pt-BR')} /></div><p className="mt-3 text-xs text-violet-900">Pesquisa web: bloqueada neste piloto. Pacotes e franquias comerciais não são aplicados ao Owner.</p></div>}
    {wallet.available !== undefined && !ownerUsage && <><div className="mt-4 grid gap-2 sm:grid-cols-4"><Metric label="Disponíveis" value={Number(wallet.available).toLocaleString('pt-BR')}/><Metric label="Franquia mensal restante" value={`${Number(wallet.monthly_remaining || 0).toLocaleString('pt-BR')} / ${Number(wallet.monthly_allowance || 0).toLocaleString('pt-BR')}`}/><Metric label="Extras" value={Number(wallet.extra_balance || 0).toLocaleString('pt-BR')}/><Metric label="Consumidos no ciclo" value={`${Number(wallet.used_this_cycle || 0).toLocaleString('pt-BR')} · renova ${wallet.cycle_end ? new Date(wallet.cycle_end).toLocaleDateString('pt-BR') : '—'}`}/></div>
      {usedPercent >= 80 && <p className={`mt-3 flex items-center gap-2 rounded-lg p-2 text-xs ${usedPercent >= 100 ? 'bg-rose-50 text-rose-700' : 'bg-amber-50 text-amber-800'}`}><AlertTriangle className="h-4 w-4"/>{usedPercent >= 100 ? 'Você consumiu 100% da franquia mensal.' : 'Você atingiu 80% da franquia mensal.'} Créditos extras só são adicionados após confirmação e pagamento aprovado.</p>}
      <div className="mt-4"><p className="mb-2 text-xs font-semibold text-slate-700">Comprar pacote adicional · pagamento único, sem renovação</p>{canPurchase ? <div className="grid gap-2 sm:grid-cols-3">{(wallet.packages || []).map((pkg) => <div key={pkg.package_code} className="rounded-xl border border-slate-200 p-3"><p className="font-semibold text-slate-800">{Number(pkg.credits).toLocaleString('pt-BR')} créditos</p><p className="mt-1 text-sm text-indigo-700">{price(pkg.price_minor)}</p><button type="button" disabled={busy} onClick={() => startPix(pkg)} className="mt-2 w-full rounded-lg bg-indigo-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">{busy && selected?.package_code === pkg.package_code ? 'Iniciando…' : 'Pagar com PIX'}</button><button type="button" disabled={busy} onClick={() => { setSelected({ ...pkg, requestId: crypto.randomUUID() }); setMethod('card'); setPayment(null); }} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 disabled:opacity-50">Cartão</button></div>)}</div> : <p className="rounded-lg bg-slate-50 p-3 text-xs text-slate-600">A compra de créditos adicionais está disponível somente para administradores e gestores da empresa.</p>}</div>
      {selected && method === 'card' && !payment && <div className="mt-4 rounded-xl border border-slate-200 p-3"><p className="text-xs text-slate-600">Pagamento único de {price(selected.price_minor)}. O crédito só entra após confirmação do webhook.</p><MercadoPagoCardTokenBrick amountMinor={selected.price_minor} email={email} onToken={submitCard} onError={(cause) => setError(cause.message || 'Cartão não processado.')}/></div>}
      {payment?.purchase && <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm"><p className="font-semibold text-amber-900">Pagamento {payment.payment?.status || 'pendente'} · ainda não creditado</p><p className="mt-1 text-xs text-amber-800">Os créditos serão liberados somente após confirmação autenticada do Mercado Pago.</p>{payment.payment?.qr_code_base64 && <img className="mt-3 h-40 w-40 rounded bg-white p-2" alt="QR code PIX" src={`data:image/png;base64,${payment.payment.qr_code_base64}`}/ >}{payment.payment?.qr_code && <textarea readOnly className="mt-2 w-full rounded border bg-white p-2 text-xs" value={payment.payment.qr_code}/ >}{payment.payment?.ticket_url && <a className="mt-2 inline-block text-xs font-semibold underline" href={payment.payment.ticket_url} target="_blank" rel="noreferrer">Abrir pagamento</a>}</div>}
      <div className="mt-4 overflow-x-auto"><table className="w-full text-left text-xs"><thead className="bg-slate-50 text-slate-500"><tr><th className="px-2 py-2">Histórico</th><th className="px-2 py-2">Créditos mensais</th><th className="px-2 py-2">Extras</th><th className="px-2 py-2">Data</th></tr></thead><tbody>{(wallet.history || []).slice(0,8).map((row,index)=><tr key={`${row.created_at}-${index}`} className="border-t"><td className="px-2 py-2">{row.type}</td><td className="px-2 py-2">{Number(row.monthly_delta)>0?'+':''}{row.monthly_delta}</td><td className="px-2 py-2">{Number(row.extra_delta)>0?'+':''}{row.extra_delta}</td><td className="px-2 py-2">{new Date(row.created_at).toLocaleDateString('pt-BR')}</td></tr>)}</tbody></table></div>
    </>}
  </section>;
}

function Metric({label,value}) { return <div className="rounded-lg bg-slate-50 p-3"><p className="text-[11px] text-slate-500">{label}</p><p className="mt-1 text-base font-semibold text-slate-900">{value}</p></div>; }
