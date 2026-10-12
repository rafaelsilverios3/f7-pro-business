import React, { useEffect, useMemo, useState } from 'react';
import { Calculator, LockKeyhole } from 'lucide-react';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { buildPricingSummary, calculateMargin, psychologicalPrice } from '@/lib/pricing';
import { buildSupplierOfferPricingScenario, classifySupplierOffersForPricing } from '@/lib/supplierOfferPricing';
import { fmtMoney } from '@/lib/business';
import SupplierOfferPricingPanel from '@/components/pricing/SupplierOfferPricingPanel';

const FIXED_FIELDS = [
  ['purchaseCost', 'Custo de compra por unidade'],
  ['freight', 'Frete total do pedido', 'Frete por unidade'],
  ['packaging', 'Embalagem por unidade'],
  ['otherCosts', 'Outras despesas por unidade'],
  ['additionalCost', 'Custo adicional por unidade'],
];
const RATE_FIELDS = [['taxPct', 'Tributos estimados'], ['financialFeePct', 'Taxa financeira'], ['commissionPct', 'Comissão']];
const CONFIDENCE_OPTIONS = [
  ['known', 'Conhecido / informado'],
  ['estimated', 'Estimado'],
  ['missing', 'Ausente'],
];

function ConfidenceSelect({ field, value, onChange }) {
  return <select aria-label={`Confiabilidade: ${field}`} value={value || 'missing'} onChange={(event) => onChange(event.target.value)} className="h-8 rounded-md border border-slate-200 bg-white px-2 text-[11px]">
    {CONFIDENCE_OPTIONS.map(([option, label]) => <option key={option} value={option}>{label}</option>)}
  </select>;
}

function CostField({ label, value, confidence, onValueChange, onConfidenceChange, disabled, helper }) {
  return <div className="space-y-1.5">
    <Label className="text-xs">{label}</Label>
    <Input aria-label={label} type="number" min="0" step="0.01" value={value} onChange={(event) => onValueChange(event.target.value)} disabled={disabled} placeholder="Não informado" />
    <div className="flex flex-wrap items-center justify-between gap-1">
      <ConfidenceSelect field={label} value={confidence} onChange={onConfidenceChange} />
      {helper && <span className="text-[10px] text-slate-500">{helper}</span>}
    </div>
  </div>;
}

function confidenceSummary(confidence) {
  const values = Object.values(confidence);
  if (values.includes('missing')) return 'Estimativa incompleta: existem custos ou taxas ausentes, tratados como zero apenas para exibir um cenário parcial.';
  if (values.includes('estimated')) return 'Simulação com estimativas. O resultado não representa margem confirmada.';
  return 'Simulação com valores informados. A disponibilidade e a validade comercial dependem da confirmação do fornecedor.';
}

export default function PricingDialog({
  open, onClose, product, canManage, onApply, onSelectPrice, companyId,
  supplierOffers = [], supplierOffersLoading = false, supplierOffersError = '',
  canReadSupplierOffers = false, onRetrySupplierOffers, salesChannels = [], productChannelLinks = [],
}) {
  const [input, setInput] = useState({ purchaseCost: '', freight: '', packaging: '', otherCosts: '', additionalCost: '', taxPct: '', financialFeePct: '', commissionPct: '', channelFeePct: '' });
  const [confidence, setConfidence] = useState({ purchaseCost: 'missing', freight: 'missing', packaging: 'missing', otherCosts: 'missing', additionalCost: 'missing', taxPct: 'missing', financialFeePct: 'missing', commissionPct: 'missing', channelFeePct: 'missing' });
  const [price, setPrice] = useState(0);
  const [selectedMargin, setSelectedMargin] = useState(30);
  const [psychological, setPsychological] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [selectedOfferId, setSelectedOfferId] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [channelId, setChannelId] = useState('');
  const [useConfiguredChannelFee, setUseConfiguredChannelFee] = useState(false);

  const offerCandidates = useMemo(() => classifySupplierOffersForPricing(supplierOffers, { companyId, productId: product?.id }), [supplierOffers, companyId, product?.id]);
  const selectedOfferCandidate = offerCandidates.find(({ offer, eligible }) => offer.id === selectedOfferId && eligible);
  const selectedOffer = selectedOfferCandidate?.offer || null;
  const selectedProductChannelLink = productChannelLinks.find((link) => link.product_id === product?.id && link.channel_id === channelId);
  const configuredChannelFee = selectedProductChannelLink?.fee_rate == null ? null : Number(selectedProductChannelLink.fee_rate);
  const channelFeePct = channelId && configuredChannelFee != null && useConfiguredChannelFee
    ? configuredChannelFee
    : Number(input.channelFeePct) || 0;
  const effectiveConfidence = {
    ...confidence,
    purchaseCost: selectedOffer ? 'known' : confidence.purchaseCost,
    channelFeePct: channelId && configuredChannelFee != null && useConfiguredChannelFee ? 'known' : confidence.channelFeePct,
  };
  const quantityNumber = Number(quantity);

  useEffect(() => {
    if (!open) return;
    const catalogCost = Number(product?.cost_price ?? product?.cost);
    const hasCatalogCost = Number.isFinite(catalogCost) && catalogCost > 0;
    setInput({ purchaseCost: hasCatalogCost ? String(catalogCost) : '', freight: '', packaging: '', otherCosts: '', additionalCost: '', taxPct: '', financialFeePct: '', commissionPct: '', channelFeePct: '' });
    setConfidence({ purchaseCost: hasCatalogCost ? 'estimated' : 'missing', freight: 'missing', packaging: 'missing', otherCosts: 'missing', additionalCost: 'missing', taxPct: 'missing', financialFeePct: 'missing', commissionPct: 'missing', channelFeePct: 'missing' });
    setPrice(Number(product?.sale_price ?? product?.price) || 0);
    setSelectedMargin(30);
    setPsychological(false);
    setError('');
    setSelectedOfferId('');
    setQuantity('1');
    setChannelId('');
    setUseConfiguredChannelFee(false);
  }, [open, product]);

  useEffect(() => {
    if (!selectedOffer) return;
    setInput((current) => ({ ...current, purchaseCost: String(selectedOffer.unit_cost) }));
    setConfidence((current) => ({ ...current, purchaseCost: 'known' }));
  }, [selectedOffer]);

  const baseInput = selectedOffer
    ? { ...input, purchaseCost: selectedOffer.unit_cost, freight: quantityNumber > 0 ? (Number(input.freight) || 0) / quantityNumber : 0, channelFeePct }
    : { ...input, channelFeePct };
  const summary = buildPricingSummary(baseInput, price);
  const selectedScenario = selectedOffer ? buildSupplierOfferPricingScenario(selectedOffer, {
    companyId,
    productId: product?.id,
    quantity,
    costs: {
      freightTotal: input.freight,
      packaging: input.packaging,
      otherCosts: input.otherCosts,
      additionalCost: input.additionalCost,
      taxPct: input.taxPct,
      financialFeePct: input.financialFeePct,
      commissionPct: input.commissionPct,
      channelFeePct,
    },
    confidence: {
      ...confidence,
      freightTotal: confidence.freight,
      channelFeePct: effectiveConfidence.channelFeePct,
    },
    price,
    targetMargin: selectedMargin,
    channelFeePct,
  }) : null;
  const canShowSupplierCalculation = !selectedOffer || selectedScenario?.feasible;
  const chosenPrice = psychological ? psychologicalPrice(price, summary.minimumPrice) : Number(price) || 0;
  const chosenMargin = calculateMargin(chosenPrice, summary.realCost, summary.variableRate);
  const setValue = (key, value) => {
    setInput((current) => ({ ...current, [key]: value }));
    if (key !== 'purchaseCost' || !selectedOffer) setConfidence((current) => ({ ...current, [key]: value === '' ? 'missing' : current[key] === 'missing' ? 'estimated' : current[key] }));
  };
  const setConfidenceValue = (key, value) => setConfidence((current) => ({ ...current, [key]: value }));
  const chooseOffer = (offer) => {
    setSelectedOfferId(offer?.id || '');
    if (!offer) {
      const catalogCost = Number(product?.cost_price ?? product?.cost);
      const hasCatalogCost = Number.isFinite(catalogCost) && catalogCost > 0;
      setInput((current) => ({ ...current, purchaseCost: hasCatalogCost ? String(catalogCost) : '' }));
      setConfidence((current) => ({ ...current, purchaseCost: hasCatalogCost ? 'estimated' : 'missing' }));
    } else {
      setInput((current) => ({ ...current, purchaseCost: String(offer.unit_cost) }));
      setConfidence((current) => ({ ...current, purchaseCost: 'known' }));
    }
  };
  const handleChannelChange = (nextId) => {
    setChannelId(nextId);
    const nextLink = productChannelLinks.find((link) => link.product_id === product?.id && link.channel_id === nextId);
    const hasConfiguredFee = nextLink?.fee_rate != null;
    setUseConfiguredChannelFee(hasConfiguredFee);
    if (!hasConfiguredFee) setConfidence((current) => ({ ...current, channelFeePct: input.channelFeePct === '' ? 'missing' : 'estimated' }));
  };
  const apply = async () => {
    if (!canManage) return;
    if (selectedOffer) { setError('Esta etapa permite somente simulações baseadas em ofertas. Nenhum custo ou preço do catálogo será gravado.'); return; }
    if (!summary.feasible) { setError('Margem inviável com os custos percentuais informados.'); return; }
    if (!(chosenPrice >= summary.minimumPrice)) { setError('O preço não pode ficar abaixo do mínimo calculado.'); return; }
    if (!window.confirm(`Aplicar ${fmtMoney(chosenPrice)} ao produto?`)) return;
    setSaving(true);
    setError('');
    try {
      await onApply?.({ price: chosenPrice, summary: { ...summary, price: chosenPrice, margin: chosenMargin, targetMargin: selectedMargin, input } });
      onClose();
    } catch (cause) {
      setError(cause.message || 'Não foi possível aplicar o preço.');
    } finally {
      setSaving(false);
    }
  };
  const chooseScenario = (scenario) => {
    setSelectedMargin(scenario.margin);
    setPrice(scenario.price ?? 0);
    setPsychological(false);
    onSelectPrice?.(scenario.price);
  };
  const qualityText = selectedOffer ? selectedScenario?.confidenceLabel : confidenceSummary(effectiveConfidence);
  const showSupplierPanel = canReadSupplierOffers && import.meta.env.VITE_DATA_PROVIDER === 'supabase';

  return <Dialog open={open} onOpenChange={onClose}>
    <DialogContent className="max-w-5xl">
      <DialogHeader><DialogTitle className="flex items-center gap-2"><Calculator className="h-5 w-5 text-blue-500" /> Precificação — {product?.name || 'Novo produto'}</DialogTitle></DialogHeader>
      <div className="max-h-[75vh] space-y-5 overflow-y-auto pr-1">
        <p className="rounded-lg border border-blue-100 bg-blue-50 p-3 text-xs text-blue-700">Simulações informativas. Tributos, custos e taxas podem ser estimativas. A tela não publica preços e não altera o catálogo durante uma simulação com oferta.</p>

        {showSupplierPanel && <SupplierOfferPricingPanel
          companyId={companyId}
          productId={product?.id}
          offers={supplierOffers}
          offersLoading={supplierOffersLoading}
          offersError={supplierOffersError}
          channels={salesChannels}
          productChannelLinks={productChannelLinks}
          selectedOfferId={selectedOfferId}
          onSelectOffer={chooseOffer}
          quantity={quantity}
          onQuantityChange={setQuantity}
          channelId={channelId}
          onChannelChange={handleChannelChange}
          manualChannelFee={input.channelFeePct}
          onManualChannelFeeChange={(value) => setValue('channelFeePct', value)}
          useConfiguredChannelFee={useConfiguredChannelFee}
          onUseConfiguredChannelFeeChange={setUseConfiguredChannelFee}
          inputs={input}
          confidence={confidence}
          price={price}
          targetMargin={selectedMargin}
        />}
        {canReadSupplierOffers && supplierOffersError && onRetrySupplierOffers && <Button type="button" variant="outline" size="sm" onClick={onRetrySupplierOffers}>Tentar carregar ofertas novamente</Button>}
        {!canReadSupplierOffers && <p className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">Ofertas de fornecedores não estão disponíveis para o papel atual. A precificação manual existente continua disponível.</p>}

        {selectedOffer && <div className="rounded-lg border border-indigo-200 bg-indigo-50 p-3 text-xs text-indigo-900"><strong>Base selecionada:</strong> {selectedOffer.supplier_name} · {selectedOffer.unit_cost} {selectedOffer.currency}/un. · mínimo {selectedOffer.minimum_order_quantity} un. · prazo {selectedOffer.lead_time_days == null ? 'não informado' : `${selectedOffer.lead_time_days} dias`}. Quantidade declarada ({selectedOffer.supplier_quantity ?? 'ausente'}) é apenas contexto e não significa estoque garantido.</div>}

        <section><h3 className="mb-2 text-sm font-semibold text-slate-800">Custos fixos</h3><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{FIXED_FIELDS.map(([key, label, manualLabel]) => {
          const isPurchaseOffer = key === 'purchaseCost' && selectedOffer;
          const displayLabel = key === 'freight' && !selectedOffer ? manualLabel : label;
          const helper = key === 'purchaseCost' && !selectedOffer && input.purchaseCost !== '' ? 'Origem: custo cadastrado; fonte não identificada' : key === 'freight' && selectedOffer ? 'Rateado pela quantidade desejada' : '';
          return <CostField key={key} label={displayLabel} value={input[key]} confidence={effectiveConfidence[key]} disabled={Boolean(isPurchaseOffer)} helper={helper} onValueChange={(value) => setValue(key, value)} onConfidenceChange={(value) => setConfidenceValue(key, value)} />;
        })}</div></section>

        <section><h3 className="mb-2 text-sm font-semibold text-slate-800">Custos percentuais sobre a venda</h3><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{RATE_FIELDS.map(([key, label]) => <CostField key={key} field={key} label={`${label} (%)`} value={input[key]} confidence={effectiveConfidence[key]} onValueChange={(value) => setValue(key, value)} onConfidenceChange={(value) => setConfidenceValue(key, value)} />)}</div></section>

        <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">{qualityText} Mesmo com valores informados, o sistema não trata disponibilidade externa como estoque nem promete resultado de marketplace.</p>

        {canShowSupplierCalculation ? <>
          <div className="grid gap-3 sm:grid-cols-3"><div className="rounded-xl border border-slate-200 bg-slate-50 p-3"><p className="text-xs text-slate-500">Custo real estimado / un.</p><p className="mt-1 text-xl font-bold text-slate-900">{fmtMoney(summary.realCost)}</p></div><div className="rounded-xl border border-slate-200 bg-slate-50 p-3"><p className="text-xs text-slate-500">Preço mínimo do cenário</p><p className="mt-1 text-xl font-bold text-slate-900">{summary.minimumPrice == null ? 'Indisponível' : fmtMoney(summary.minimumPrice)}</p></div><div className="rounded-xl border border-slate-200 bg-slate-50 p-3"><p className="text-xs text-slate-500">Taxas variáveis consideradas</p><p className="mt-1 text-xl font-bold text-slate-900">{summary.variableRate.toFixed(2)}%</p></div></div>
          {selectedScenario && <div className="rounded-lg border border-slate-200 bg-white p-3 text-xs text-slate-700">Investimento aproximado para {selectedScenario.quantity} unidade(s): <strong>{fmtMoney(selectedScenario.orderInvestment)}</strong>. Mínimo do produto: <strong>{fmtMoney(selectedScenario.minimumOrderInvestment)}</strong> sem frete. A quantidade informada pelo fornecedor é declaratória.</div>}
          <section><h3 className="mb-2 text-sm font-semibold text-slate-800">Cenários de margem para {channelId ? salesChannels.find((item) => item.id === channelId)?.name : 'o canal informado'}</h3><div className="grid grid-cols-3 gap-2 sm:grid-cols-6">{summary.scenarios.map((scenario) => <button type="button" key={scenario.margin} onClick={() => chooseScenario(scenario)} className={`rounded-lg border p-2 text-center text-xs transition ${selectedMargin === scenario.margin ? 'border-transparent bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-md shadow-blue-900/20' : 'border-slate-200 hover:border-blue-300 hover:bg-blue-500/10'}`}><span className="block font-semibold">{scenario.margin}%</span><span className="mt-1 block">{scenario.price == null ? 'Indisponível' : fmtMoney(scenario.price)}</span></button>)}</div></section>
          <section className="rounded-xl border border-slate-200 p-4"><div className="flex items-center justify-between gap-3"><div><Label>Preço da simulação</Label><p className="text-xs text-slate-500">Markup {summary.markup.toFixed(1)}% · margem simulada {chosenMargin.toFixed(1)}%</p></div><Input aria-label="Preço para simulação" className="w-36 text-right text-lg font-bold" type="number" min={summary.minimumPrice} step="0.01" value={price} onChange={(event) => { setPrice(event.target.value); setPsychological(false); onSelectPrice?.(event.target.value); }} /></div><label className="mt-3 flex items-center gap-2 text-xs text-slate-600"><input type="checkbox" checked={psychological} onChange={(event) => setPsychological(event.target.checked)} /> Sugerir arredondamento comercial ({fmtMoney(chosenPrice)})</label></section>
        </> : <p role="status" className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">A quantidade informada está abaixo do pedido mínimo desta oferta. A margem e o preço alvo não serão calculados para este cenário.</p>}
        {!summary.feasible && canShowSupplierCalculation && <p className="text-xs font-medium text-rose-600">Margem inviável com os custos percentuais informados.</p>}
        {error && <p role="alert" className="text-xs text-rose-600">{error}</p>}
      </div>
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onClose}>Fechar</Button>
        {selectedOffer ? <Button type="button" disabled><LockKeyhole className="mr-1.5 h-4 w-4" /> Simulação sem gravação</Button>
          : canManage ? <Button type="button" onClick={apply} disabled={saving || !summary.feasible}>{saving ? 'Aplicando...' : 'Aplicar preço ao produto'}</Button>
            : <Button type="button" disabled><LockKeyhole className="mr-1.5 h-4 w-4" /> Somente visualização</Button>}
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
