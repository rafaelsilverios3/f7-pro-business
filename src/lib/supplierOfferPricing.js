import { buildPricingSummary, priceForMargin } from './pricing.js';
import { roundMoney } from './calculations.js';

export const PRICING_BASE_CURRENCY = 'BRL';

const asNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
};

export function assessSupplierOfferForPricing(offer, {
  companyId,
  productId,
  today = new Date().toISOString().slice(0, 10),
  baseCurrency = PRICING_BASE_CURRENCY,
} = {}) {
  const reasons = [];
  if (!companyId || offer?.company_id !== companyId) reasons.push('A oferta não pertence à empresa ativa.');
  if (!productId || offer?.product_id !== productId) reasons.push('A oferta está vinculada a outro produto.');
  if (offer?.status !== 'approved') reasons.push('A oferta não está aprovada.');
  if (!offer?.verified_at || !offer?.verified_by) reasons.push('A oferta não possui verificação humana registrada.');
  if (!offer?.approved_at || !offer?.approved_by) reasons.push('A aprovação humana não está registrada.');
  if (!offer?.valid_until) reasons.push('A oferta não tem data de validade.');
  else if (offer.valid_until < today) reasons.push('A oferta está vencida.');
  if (offer?.currency !== baseCurrency) reasons.push(`Moeda ${offer?.currency || 'ausente'} sem conversão válida para ${baseCurrency}.`);

  return { eligible: reasons.length === 0, reasons };
}

export function classifySupplierOffersForPricing(offers = [], scope = {}) {
  return offers
    .filter((offer) => offer?.company_id === scope.companyId && offer?.product_id === scope.productId)
    .map((offer) => ({
      offer,
      ...assessSupplierOfferForPricing(offer, scope),
    }));
}

export function buildSupplierOfferPricingScenario(offer, {
  companyId,
  productId,
  today,
  quantity,
  costs = {},
  confidence = {},
  price = 0,
  targetMargin = 30,
  channelFeePct = 0,
} = {}) {
  const requestedQuantity = Number(quantity);
  const minimumQuantity = Number(offer?.minimum_order_quantity);
  const unitCost = Number(offer?.unit_cost);
  const eligibility = assessSupplierOfferForPricing(offer, { companyId, productId, today });
  const reasons = [...eligibility.reasons];
  const providedCostValues = { ...costs, channelFeePct };

  for (const [key, value] of Object.entries(providedCostValues)) {
    if (value === null || value === undefined || String(value).trim() === '') continue;
    if (!Number.isFinite(Number(value)) || Number(value) < 0) reasons.push(`O valor informado para ${key} é inválido.`);
  }

  if (!Number.isFinite(requestedQuantity) || requestedQuantity <= 0) reasons.push('Informe uma quantidade desejada maior que zero.');
  if (!Number.isFinite(minimumQuantity) || minimumQuantity <= 0) reasons.push('O pedido mínimo da oferta é inválido.');
  if (!Number.isFinite(unitCost) || unitCost < 0) reasons.push('O custo unitário da oferta é inválido.');
  if (requestedQuantity > 0 && minimumQuantity > 0 && requestedQuantity < minimumQuantity) reasons.push(`Quantidade abaixo do pedido mínimo (${minimumQuantity}).`);

  const freightTotal = asNumber(costs.freightTotal);
  const freightPerUnit = requestedQuantity > 0 ? freightTotal / requestedQuantity : 0;
  const calculationInput = {
    purchaseCost: asNumber(unitCost),
    freight: freightPerUnit,
    packaging: asNumber(costs.packaging),
    otherCosts: asNumber(costs.otherCosts),
    additionalCost: asNumber(costs.additionalCost),
    taxPct: asNumber(costs.taxPct),
    financialFeePct: asNumber(costs.financialFeePct),
    commissionPct: asNumber(costs.commissionPct),
    channelFeePct: asNumber(channelFeePct),
  };
  const confidenceValues = { ...costs, channelFeePct };
  const completeCostKeys = ['freightTotal', 'packaging', 'otherCosts', 'additionalCost', 'taxPct', 'financialFeePct', 'commissionPct', 'channelFeePct'];
  const missing = completeCostKeys.filter((key) => {
    const raw = confidenceValues[key];
    const hasValue = raw !== null && raw !== undefined && String(raw).trim() !== ''
      && Number.isFinite(Number(raw)) && Number(raw) >= 0;
    return !hasValue || !['known', 'estimated'].includes(confidence[key]);
  });
  const estimated = completeCostKeys.filter((key) => confidence[key] === 'estimated');
  const normalizedQuantity = Number.isFinite(requestedQuantity) && requestedQuantity > 0 ? requestedQuantity : 0;
  const minimumOrderInvestment = Number.isFinite(minimumQuantity) && minimumQuantity > 0 && Number.isFinite(unitCost)
    ? roundMoney(minimumQuantity * unitCost)
    : null;
  const orderInvestment = normalizedQuantity >= minimumQuantity && Number.isFinite(unitCost)
    ? roundMoney((normalizedQuantity * unitCost) + freightTotal)
    : null;
  const feasible = reasons.length === 0;
  const summary = feasible ? buildPricingSummary(calculationInput, price) : null;

  return {
    feasible,
    reasons,
    currency: offer?.currency || null,
    quantity: normalizedQuantity,
    minimumQuantity,
    unitCost,
    freightPerUnit: roundMoney(freightPerUnit),
    minimumOrderInvestment,
    orderInvestment,
    declaredSupplierQuantity: offer?.supplier_quantity ?? null,
    leadTimeDays: offer?.lead_time_days ?? null,
    summary,
    targetPrice: feasible ? priceForMargin(targetMargin, calculationInput) : null,
    missing,
    estimated,
    confidenceLabel: missing.length ? 'Estimativa incompleta' : estimated.length ? 'Simulação com estimativas' : 'Simulação com valores informados',
  };
}
