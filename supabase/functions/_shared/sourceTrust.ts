export type SourceTrustLevel = 'HIGH_TRUST' | 'MEDIUM_TRUST' | 'LOW_TRUST' | 'INSUFFICIENT_DATA';

export type SourceTrustInput = {
  source_type?: string;
  domain?: string;
  company_identity_match?: boolean;
  reputation?: number | null;
  review_volume?: number | null;
  review_patterns?: 'consistent' | 'mixed' | 'suspicious' | null;
  complaints?: number | null;
  delivery_issues?: number | null;
  counterfeit_claims?: number | null;
  description_mismatch?: boolean;
  price_anomaly?: boolean;
  evidence_count?: number;
  retrieved_at?: string;
  cross_source_agreement?: number;
};

function ratio(value: number | null | undefined) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return Math.min(1, Math.max(0, number > 1 ? number / 100 : number));
}

function boundedCount(value: number | null | undefined, max = 10) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(0, number)) : 0;
}

export function evaluateSourceTrust(input: SourceTrustInput) {
  const type = String(input.source_type || '');
  const domain = String(input.domain || '').toLocaleLowerCase('en-US');
  let score = type === 'manufacturer_official' ? 0.88 : type === 'approved_catalog' ? 0.72 : type === 'distributor' ? 0.56 : domain ? 0.38 : 0;
  if (input.company_identity_match === true) score += 0.04;
  const reputation = ratio(input.reputation);
  if (reputation !== null) score += (reputation - 0.5) * 0.12;
  score += Math.min(0.04, Math.log10(boundedCount(input.review_volume, 10_000) + 1) * 0.01);
  if (input.review_patterns === 'consistent') score += 0.03;
  if (input.review_patterns === 'mixed') score -= 0.03;
  if (input.review_patterns === 'suspicious') score -= 0.12;
  score -= Math.min(0.12, boundedCount(input.complaints) * 0.02);
  score -= Math.min(0.1, boundedCount(input.delivery_issues) * 0.02);
  score -= Math.min(0.2, boundedCount(input.counterfeit_claims) * 0.05);
  if (input.description_mismatch) score -= 0.16;
  if (input.price_anomaly) score -= 0.1;
  score += Math.min(0.06, Math.max(0, Number(input.evidence_count || 0) - 1) * 0.02);
  score += Math.min(0.05, Math.max(0, Number(input.cross_source_agreement || 0)) * 0.02);
  const retrievedAt = Date.parse(String(input.retrieved_at || ''));
  const ageDays = Number.isFinite(retrievedAt) ? Math.max(0, (Date.now() - retrievedAt) / 86_400_000) : null;
  if (ageDays !== null && ageDays > 730) score -= 0.08;
  else if (ageDays !== null && ageDays > 365) score -= 0.04;
  score = Math.round(Math.min(0.99, Math.max(0, score)) * 100) / 100;
  const level: SourceTrustLevel = score >= 0.85 ? 'HIGH_TRUST' : score >= 0.6 ? 'MEDIUM_TRUST' : score > 0 ? 'LOW_TRUST' : 'INSUFFICIENT_DATA';
  return {
    score,
    level,
    factors: {
      authority: type || null,
      domain: domain || null,
      official_status: type === 'manufacturer_official',
      company_identity: input.company_identity_match ?? null,
      reputation,
      review_volume: input.review_volume ?? null,
      review_patterns: input.review_patterns ?? null,
      complaints: input.complaints ?? null,
      delivery_issues: input.delivery_issues ?? null,
      counterfeit_claims: input.counterfeit_claims ?? null,
      description_mismatch: input.description_mismatch ?? null,
      price_anomaly: input.price_anomaly ?? null,
      source_age_days: ageDays === null ? null : Math.round(ageDays),
      cross_source_agreement: Number(input.cross_source_agreement || 0),
    },
  };
}
