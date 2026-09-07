export const TRUST_LABELS = Object.freeze({ LOW: 'baixo risco aparente', MODERATE: 'risco moderado', HIGH: 'risco elevado', UNKNOWN: 'dados insuficientes' });
export const SUPPLIER_SCORE_KEYS = Object.freeze(['reputation', 'history', 'price', 'delivery', 'returns', 'complaints', 'consistency']);
export function normalizeSupplierScores(scores = {}) { return Object.fromEntries(SUPPLIER_SCORE_KEYS.map((key) => [key, Math.max(0, Math.min(100, Number(scores[key] ?? 0)))])); }
export function calculateSupplierScore(scores = {}) { const normalized = normalizeSupplierScores(scores); return Math.round(Object.values(normalized).reduce((sum, value) => sum + value, 0) / SUPPLIER_SCORE_KEYS.length); }
export function trustLabel(score, confidence = 0) { if (confidence < 30) return TRUST_LABELS.UNKNOWN; if (score >= 70) return TRUST_LABELS.LOW; if (score >= 40) return TRUST_LABELS.MODERATE; return TRUST_LABELS.HIGH; }
export const RISK_SIGNAL_TYPES = Object.freeze(['repeated_reviews', 'artificial_spike', 'generic_comments', 'below_market_price', 'recent_domain', 'unidentified_company', 'counterfeit_signal', 'copied_listing', 'serious_complaints']);
