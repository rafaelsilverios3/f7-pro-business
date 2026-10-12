import React, { useMemo } from 'react';
import { classifySupplierOffersForPricing, buildSupplierOfferPricingScenario } from '@/lib/supplierOfferPricing';

function money(value, currency = 'BRL') {
  if (value == null || !Number.isFinite(Number(value))) return '—';
  try { return new Intl.NumberFormat('pt-BR', { style: 'currency', currency }).format(Number(value)); }
  catch { return `${Number(value).toFixed(2)} ${currency}`; }
}

function offerStatus(offer) {
  if (offer.valid_until && offer.valid_until < new Date().toISOString().slice(0, 10) && offer.status === 'approved') return 'Expirada';
  return ({ draft: 'Rascunho', pending_verification: 'A verificar', verified: 'Verificada; aguardando aprovação', approved: 'Aprovada', suspended: 'Suspensa', expired: 'Expirada' })[offer.status] || 'Estado indisponível';
}

export default function SupplierOfferPricingPanel({
  companyId, productId, offers = [], offersLoading, offersError, channels = [], productChannelLinks = [],
  selectedOfferId, onSelectOffer, quantity, onQuantityChange, channelId, onChannelChange,
  manualChannelFee, onManualChannelFeeChange, useConfiguredChannelFee, onUseConfiguredChannelFeeChange,
  inputs, confidence, price, targetMargin, onScenarioContext,
}) {
  const classified = useMemo(() => classifySupplierOffersForPricing(offers, { companyId, productId }), [offers, companyId, productId]);
  const eligible = classified.filter((item) => item.eligible);
  const contextual = classified.filter((item) => !item.eligible);
  const channelLink = productChannelLinks.find((link) => link.product_id === productId && link.channel_id === channelId);
  const configuredFee = channelLink?.fee_rate == null ? null : Number(channelLink.fee_rate);
  const effectiveFee = channelId && configuredFee != null && useConfiguredChannelFee ? configuredFee : Number(manualChannelFee) || 0;
  const feeConfidence = channelId && configuredFee != null && useConfiguredChannelFee ? 'known' : confidence.channelFeePct || 'missing';
  const scenarioCosts = {
    freightPerUnit: inputs.freight,
    packaging: inputs.packaging,
    otherCosts: inputs.otherCosts,
    additionalCost: inputs.additionalCost,
    taxPct: inputs.taxPct,
    financialFeePct: inputs.financialFeePct,
    commissionPct: inputs.commissionPct,
    channelFeePct: effectiveFee,
  };
  const scenarioConfidence = { ...confidence, freightPerUnit: confidence.freight, channelFeePct: feeConfidence };

  const reportContext = (next = {}) => onScenarioContext?.({
    quantity,
    channelFeePct: effectiveFee,
    channelFeeConfidence: feeConfidence,
    ...next,
  });

  const changeChannel = (nextChannelId) => {
    onChannelChange(nextChannelId);
    const nextLink = productChannelLinks.find((link) => link.product_id === productId && link.channel_id === nextChannelId);
    const nextConfiguredFee = nextLink?.fee_rate == null ? null : Number(nextLink.fee_rate);
    const useConfigured = nextConfiguredFee != null;
    onUseConfiguredChannelFeeChange(useConfigured);
    reportContext({ channelFeePct: useConfigured ? nextConfiguredFee : Number(manualChannelFee) || 0, channelFeeConfidence: useConfigured ? 'known' : confidence.channelFeePct || 'missing' });
  };

  const chooseOffer = (offer) => {
    onSelectOffer(selectedOfferId === offer.id ? null : offer);
  };

  return <section className="space-y-4 rounded-xl border border-indigo-200 bg-indigo-50/50 p-4" aria-labelledby="supplier-pricing-title">
    <div>
      <h3 id="supplier-pricing-title" className="font-semibold text-slate-900">Referências de fornecedores</h3>
      <p className="mt-1 text-xs leading-5 text-slate-600">A simulação usa somente ofertas aprovadas, verificadas, vigentes, do produto e da empresa atuais, em BRL. A disponibilidade declarada pelo fornecedor não é estoque confirmado. Nenhuma oferta será escolhida automaticamente.</p>
    </div>

    <div className="grid gap-3 sm:grid-cols-2">
      <label className="space-y-1 text-xs font-medium text-slate-700">Quantidade desejada
        <input aria-label="Quantidade desejada para simulação" type="number" min="1" step="1" value={quantity} onChange={(event) => { const next = event.target.value; onQuantityChange(next); reportContext({ quantity: next }); }} className="h-9 w-full rounded-md border border-slate-200 bg-white px-3 text-sm" />
      </label>
      <label className="space-y-1 text-xs font-medium text-slate-700">Canal para simular
        <select aria-label="Canal da simulação de preço" value={channelId} onChange={(event) => changeChannel(event.target.value)} className="h-9 w-full rounded-md border border-slate-200 bg-white px-3 text-sm">
          <option value="">Sem canal específico</option>
          {channels.map((channel) => <option key={channel.id} value={channel.id}>{channel.name} · {channel.channel_type}</option>)}
        </select>
      </label>
    </div>

    <div className="rounded-lg border border-white bg-white/80 p-3">
      {channelId && configuredFee != null && <label className="flex items-start gap-2 text-xs text-slate-700">
        <input type="checkbox" checked={useConfiguredChannelFee} onChange={(event) => { const useConfigured = event.target.checked; onUseConfiguredChannelFeeChange(useConfigured); reportContext({ channelFeePct: useConfigured ? configuredFee : Number(manualChannelFee) || 0, channelFeeConfidence: useConfigured ? 'known' : confidence.channelFeePct || 'missing' }); }} />
        <span>Usar taxa configurada no vínculo deste produto: <strong>{configuredFee.toFixed(2)}%</strong>. É uma configuração da empresa; não foi confirmada pelo marketplace.</span>
      </label>}
      {(!channelId || configuredFee == null || !useConfiguredChannelFee) && <div className="flex flex-wrap items-end gap-3">
        <label className="min-w-40 flex-1 space-y-1 text-xs font-medium text-slate-700">Taxa do canal (%)
          <input aria-label="Taxa de canal estimada" type="number" min="0" max="99.99" step="0.01" value={manualChannelFee} onChange={(event) => { const next = event.target.value; onManualChannelFeeChange(next); reportContext({ channelFeePct: Number(next) || 0, channelFeeConfidence: next === '' ? 'missing' : 'estimated' }); }} className="h-9 w-full rounded-md border border-slate-200 bg-white px-3 text-sm" placeholder="Não informada" />
        </label>
        <span className="pb-2 text-[11px] text-amber-700">{manualChannelFee === '' ? 'Taxa ausente; o cálculo parcial usa zero e será identificado como incompleto.' : 'Estimativa manual, não validada pelo marketplace.'}</span>
      </div>}
      {channelId && configuredFee == null && <p className="mt-2 text-[11px] text-amber-700">Não há taxa cadastrada para este vínculo produto/canal.</p>}
    </div>

    {offersLoading && <p role="status" className="text-sm text-slate-500">Carregando ofertas da empresa…</p>}
    {offersError && <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">Não foi possível consultar ofertas com a sessão e as permissões atuais. {offersError}</p>}
    {!offersLoading && !offersError && eligible.length === 0 && <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">Não há ofertas elegíveis em BRL para este produto. Nenhum custo externo será usado.</p>}

    {eligible.length > 0 && <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
      <table className="w-full min-w-[880px] text-xs">
        <thead><tr className="border-b bg-slate-50 text-left text-slate-500"><th className="px-3 py-2">Oferta / fornecedor</th><th className="px-3 py-2">Custo unitário</th><th className="px-3 py-2">Pedido mínimo</th><th className="px-3 py-2">Investimento no cenário</th><th className="px-3 py-2">Prazo / quantidade declarada</th><th className="px-3 py-2">Margem simulada no preço atual</th><th className="px-3 py-2">Preço simulado para margem alvo</th><th className="px-3 py-2" /></tr></thead>
        <tbody>{eligible.map(({ offer }) => {
          const row = buildSupplierOfferPricingScenario(offer, { companyId, productId, quantity, costs: scenarioCosts, confidence: scenarioConfidence, price, targetMargin, channelFeePct: effectiveFee });
          return <tr key={offer.id} className={`border-b last:border-0 ${selectedOfferId === offer.id ? 'bg-indigo-50' : ''}`}>
            <td className="px-3 py-2"><strong>{offer.supplier_name || 'Fornecedor'}</strong><span className="block text-slate-500">Válida até {offer.valid_until}</span></td>
            <td className="px-3 py-2">{money(offer.unit_cost, offer.currency)}<span className="block text-slate-500">oferta aprovada/verificada</span></td>
            <td className="px-3 py-2">{offer.minimum_order_quantity} un.<span className="block text-slate-500">mínimo: {money(row.minimumOrderInvestment, offer.currency)} sem frete</span></td>
            <td className="px-3 py-2">{row.feasible ? money(row.orderInvestment, offer.currency) : 'Abaixo do mínimo'}<span className="block text-slate-500">frete do pedido incluído quando informado</span></td>
            <td className="px-3 py-2">{row.leadTimeDays == null ? 'Prazo ausente' : `${row.leadTimeDays} dias`}<span className="block text-slate-500">Qtd. declarada: {row.declaredSupplierQuantity ?? 'ausente'}; não confirmada</span></td>
            <td className="px-3 py-2">{row.summary ? `≈ ${row.summary.margin.toFixed(2)}%` : 'Não calculada'}<span className="block text-amber-700">{row.confidenceLabel}</span></td>
            <td className="px-3 py-2">{row.targetPrice == null ? 'Não disponível' : money(row.targetPrice, offer.currency)}<span className="block text-amber-700">{row.confidenceLabel}</span></td>
            <td className="px-3 py-2"><button type="button" onClick={() => chooseOffer(offer)} className="rounded-md border border-indigo-200 px-2 py-1 font-medium text-indigo-700 hover:bg-indigo-50">{selectedOfferId === offer.id ? 'Selecionada' : 'Simular'}</button></td>
          </tr>;
        })}</tbody>
      </table>
    </div>}

    {contextual.length > 0 && <details className="rounded-lg border border-slate-200 bg-white p-3">
      <summary className="cursor-pointer text-sm font-medium text-slate-700">Ofertas apenas como contexto ({contextual.length})</summary>
      <ul className="mt-2 space-y-2">{contextual.map(({ offer, reasons }) => <li key={offer.id} className="flex flex-wrap justify-between gap-2 border-t border-slate-100 pt-2 text-xs"><span><strong>{offer.supplier_name || 'Fornecedor'}</strong> · {offerStatus(offer)} · {money(offer.unit_cost, offer.currency)}</span><span className="text-amber-700">{reasons.join(' ')}</span></li>)}</ul>
    </details>}

    {selectedOfferId && <p className="rounded-lg border border-indigo-200 bg-white p-3 text-xs text-indigo-900">A oferta selecionada é apenas base para esta simulação. O resultado não atualiza custo ou preço do catálogo, não cria compra nem reserva disponibilidade do fornecedor.</p>}
  </section>;
}
