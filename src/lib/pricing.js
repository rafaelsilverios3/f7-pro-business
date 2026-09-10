import { roundMoney } from './calculations.js';

const num = (value) => Math.max(0, Number(value) || 0);

export function calculateRealCost(input = {}) {
  return roundMoney(num(input.purchaseCost) + num(input.freight) + num(input.packaging) + num(input.otherCosts) + num(input.additionalCost));
}

export function calculateVariableRate(input = {}) {
  return num(input.taxPct) + num(input.financialFeePct) + num(input.commissionPct) + num(input.channelFeePct);
}

export function calculateMarkup(price, realCost) {
  return realCost > 0 ? ((num(price) - realCost) / realCost) * 100 : 0;
}

export function calculateMargin(price, realCost, variableRate = 0) {
  const salePrice = num(price);
  return salePrice > 0 ? ((salePrice - realCost - salePrice * (num(variableRate) / 100)) / salePrice) * 100 : 0;
}

export function priceForMargin(targetMarginPct, input = {}) {
  const realCost = calculateRealCost(input);
  const variableRate = calculateVariableRate(input) / 100;
  const denominator = 1 - variableRate - (num(targetMarginPct) / 100);
  return denominator > 0 ? roundMoney(realCost / denominator) : null;
}

export function calculateMinimumPrice(input = {}) {
  const realCost = calculateRealCost(input);
  const denominator = 1 - calculateVariableRate(input) / 100;
  return denominator > 0 ? roundMoney(realCost / denominator) : null;
}

export function psychologicalPrice(price, minimum = 0) {
  const target = Math.max(num(price), num(minimum));
  const integer = Math.floor(target);
  const candidates = [integer + 0.9, integer + 4.9, integer + 9.9];
  return roundMoney(candidates.find((candidate) => candidate >= target) || integer + 9.9);
}

export function buildPricingScenarios(input = {}, margins = [20, 25, 30, 35, 40, 50]) {
  return margins.map((margin) => ({ margin, price: priceForMargin(margin, input) }));
}

export function buildPricingSummary(input = {}, price = 0) {
  const realCost = calculateRealCost(input);
  const variableRate = calculateVariableRate(input);
  const minimumPrice = calculateMinimumPrice(input);
  return { realCost, variableRate, price: num(price), markup: calculateMarkup(price, realCost), margin: calculateMargin(price, realCost, variableRate), minimumPrice, feasible: minimumPrice != null, scenarios: buildPricingScenarios(input) };
}

export function buildPricingRecommendation(input = {}, price = 0) {
  const summary = buildPricingSummary(input, price);
  const configured = ['purchaseCost', 'freight', 'taxPct', 'financialFeePct', 'packaging', 'commissionPct', 'channelFeePct', 'otherCosts', 'additionalCost'].filter((key) => input[key] !== undefined && input[key] !== null && input[key] !== '');
  const missing = input.purchaseCost === undefined || input.purchaseCost === null || input.purchaseCost === '' ? ['purchaseCost'] : [];
  return { ...summary, configured_components: configured, missing_components: missing, status: missing.length ? 'NEEDS_CONFIGURATION' : summary.feasible ? 'READY_FOR_HUMAN_REVIEW' : 'INFEASIBLE', assumptions: [], policy: { advisory_only: true, automatic_price_change_allowed: false, automatic_tax_estimation_allowed: false, requires_human_approval: true } };
}
