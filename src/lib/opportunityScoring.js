export const OPPORTUNITY_STATUSES = Object.freeze({ DISCOVERY: 'descoberta', ANALYSIS: 'em_analise', VALIDATED: 'validada', TEST: 'teste', DISCARDED: 'descartada', CONVERTED: 'convertida_em_produto' });
export const SCORE_KEYS = Object.freeze(['demand', 'growth', 'competition', 'margin', 'risk', 'suppliers', 'logistics', 'capital', 'seasonality', 'fit']);
export function normalizeScores(scores = {}) { return Object.fromEntries(SCORE_KEYS.map((key) => [key, Math.max(0, Math.min(100, Number(scores[key] ?? 0)))])); }
export function calculateOpportunityScore(scores = {}) { const values = Object.values(normalizeScores(scores)); return values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : 0; }
