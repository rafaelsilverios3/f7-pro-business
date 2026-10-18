import { buildPricingSummary, priceForMargin } from './pricing.js';
import { roundMoney } from './calculations.js';

export const PRICING_BASE_CURRENCY = 'BRL';
export const SUPPLIER_AVAILABILITY_MAX_AGE_DAYS = 7;

const quantityUnit = '(?:un(?:idades?)?|unid(?:ades)?|peças?|pecas)';

export function parseRequestedSupplierQuantity(message) {
  const text = String(message || '');
  const unitMatch = text.match(new RegExp(`\\b(\\d+(?:[.,]\\d+)?)\\s*${quantityUnit}\\b`, 'i'));
  const explicitMatch = text.match(/\b(?:quantidade|solicito|preciso|quero)\s*(?:de\s*)?(\d+(?:[.,]\d+)?)(?:\s*(?:un(?:idades?)?|unid(?:ades)?|peças?|pecas))?\b/i);
  const raw = unitMatch?.[1] ?? explicitMatch?.[1];
  if (!raw) return null;
  const value = Number(raw.replace(',', '.'));
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function validIsoDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/** @param {any} offer @param {{ quantity?: number, today?: string, maxAgeDays?: number }} [options] */
export function assessDeclaredSupplierAvailability(offer, {
  quantity,
  today = new Date().toISOString().slice(0, 10),
  maxAgeDays = SUPPLIER_AVAILABILITY_MAX_AGE_DAYS,
} = {}) {
  const requestedQuantity = Number(quantity);
  const declaredQuantity = offer?.supplier_quantity == null ? null : Number(offer.supplier_quantity);
  const observedAt = offer?.observed_at ?? null;
  const validRequest = Number.isFinite(requestedQuantity) && requestedQuantity > 0;
  const validDeclaration = declaredQuantity !== null && Number.isFinite(declaredQuantity) && declaredQuantity >= 0;
  const validObservation = validIsoDate(observedAt) && validIsoDate(today);

  if (!validRequest || !validDeclaration || !validObservation) {
    return { status: 'unknown', requested_quantity: validRequest ? requestedQuantity : null, declared_quantity: validDeclaration ? declaredQuantity : null, observed_at: observedAt, shortfall: null };
  }

  const ageDays = Math.floor((Date.parse(`${today}T00:00:00.000Z`) - Date.parse(`${observedAt}T00:00:00.000Z`)) / 86400000);
  if (ageDays < 0) return { status: 'unknown', requested_quantity: requestedQuantity, declared_quantity: declaredQuantity, observed_at: observedAt, shortfall: null };
  if (ageDays > maxAgeDays) return { status: 'stale', requested_quantity: requestedQuantity, declared_quantity: declaredQuantity, observed_at: observedAt, age_days: ageDays, shortfall: Math.max(0, requestedQuantity - declaredQuantity) };
  if (declaredQuantity < requestedQuantity) return { status: 'insufficient', requested_quantity: requestedQuantity, declared_quantity: declaredQuantity, observed_at: observedAt, age_days: ageDays, shortfall: roundMoney(requestedQuantity - declaredQuantity) };
  return { status: 'sufficient_declared', requested_quantity: requestedQuantity, declared_quantity: declaredQuantity, observed_at: observedAt, age_days: ageDays, shortfall: 0 };
}

/** @param {{ availability?: any, scenario?: any }} [input] */
export function canPresentSupplierOfferScenario({ availability, scenario } = {}) {
  return availability?.status === 'sufficient_declared' && scenario?.feasible === true;
}

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

/** @param {any} offer @param {{ companyId?: string, productId?: string, today?: string, quantity?: number, costs?: Record<string, number>, confidence?: Record<string, string>, price?: number, targetMargin?: number, channelFeePct?: number }} [options] */
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

  const normalizedQuantity = Number.isFinite(requestedQuantity) && requestedQuantity > 0 ? requestedQuantity : 0;
  const freightPerUnit = asNumber(costs.freightPerUnit);
  const freightTotal = roundMoney(freightPerUnit * normalizedQuantity);
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
  const completeCostKeys = ['freightPerUnit', 'packaging', 'otherCosts', 'additionalCost', 'taxPct', 'financialFeePct', 'commissionPct', 'channelFeePct'];
  const missing = completeCostKeys.filter((key) => {
    const raw = confidenceValues[key];
    const hasValue = raw !== null && raw !== undefined && String(raw).trim() !== ''
      && Number.isFinite(Number(raw)) && Number(raw) >= 0;
    return !hasValue || !['known', 'estimated'].includes(confidence[key]);
  });
  const estimated = completeCostKeys.filter((key) => confidence[key] === 'estimated');
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
