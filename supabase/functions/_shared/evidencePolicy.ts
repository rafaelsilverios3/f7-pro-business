export const REJECTED_CANDIDATE_REASONS = [
  'REGION_MISMATCH', 'REGION_UNVERIFIED', 'APPLICATION_MISMATCH',
  'CATALOG_EDITION_MISMATCH', 'INSUFFICIENT_EVIDENCE', 'LOW_TRUST_SOURCE', 'CONFLICTING_EVIDENCE',
] as const;
export type RejectedCandidateReason = typeof REJECTED_CANDIDATE_REASONS[number];

type RegionContext = { country?: string | null; market?: string | null; region?: string | null };
type Candidate = RegionContext & { model?: string | null; source_type?: string; source_url?: string; supporting_sources?: unknown[]; evidence?: unknown[]; trust_score?: number; trust_level?: string; catalog_edition?: string | null; [key: string]: unknown };

function normalized(value: unknown) { return String(value || '').trim().toLowerCase(); }
function family(value: RegionContext) {
  const text = `${normalized(value.country)} ${normalized(value.market)} ${normalized(value.region)}`;
  if (/\bbr\b|brazil|brasil|south[_ -]?america/.test(text)) return 'south_america';
  if (/\bus\b|usa|united[_ -]?states|north[_ -]?america/.test(text)) return 'north_america';
  return null;
}
export function candidateRejectionReasons(candidate: Candidate, target: RegionContext & { model?: string | null } = {}): RejectedCandidateReason[] {
  const reasons: RejectedCandidateReason[] = [];
  const targetRegion = family(target);
  const candidateRegion = family(candidate);
  if (targetRegion && candidateRegion && targetRegion !== candidateRegion) reasons.push('REGION_MISMATCH');
  else if (targetRegion && !candidateRegion && candidate.source_type !== 'internal_catalog' && candidate.source_type !== 'verified_application' && candidate.source_type !== 'company_verified_knowledge') reasons.push('REGION_UNVERIFIED');
  const targetModel = normalized(target.model).replace(/[^a-z0-9]/g, '');
  const candidateModel = normalized(candidate.model).replace(/[^a-z0-9]/g, '');
  if (targetModel && candidateModel && targetModel !== candidateModel) reasons.push('APPLICATION_MISMATCH');
  const evidenceCount = (Array.isArray(candidate.supporting_sources) ? candidate.supporting_sources.length : 0)
    + (Array.isArray(candidate.evidence) ? candidate.evidence.length : 0)
    + (candidate.source_url ? 1 : 0);
  if (evidenceCount === 0) reasons.push('INSUFFICIENT_EVIDENCE');
  if (Number(candidate.trust_score || 0) < 0.35 && ['LOW', 'INSUFFICIENT_DATA'].includes(String(candidate.trust_level || ''))) reasons.push('LOW_TRUST_SOURCE');
  return [...new Set(reasons)];
}

export function partitionCandidatesByEligibility<T extends Candidate>(candidates: T[], target: RegionContext & { model?: string | null } = {}) {
  const eligible_candidates: T[] = [];
  const rejected_candidates: Array<T & { rejection_reason: RejectedCandidateReason; rejection_reasons: RejectedCandidateReason[] }> = [];
  for (const candidate of Array.isArray(candidates) ? candidates : []) {
    const reasons = candidateRejectionReasons(candidate, target);
    if (!reasons.length) eligible_candidates.push(candidate);
    else rejected_candidates.push({ ...candidate, rejection_reason: reasons[0], rejection_reasons: reasons });
  }
  return { eligible_candidates, rejected_candidates };
}
