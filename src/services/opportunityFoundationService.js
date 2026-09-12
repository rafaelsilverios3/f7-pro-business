import { createRepository } from '@/data/repositoryFactory';
export { OPPORTUNITY_STATUSES, SCORE_KEYS, normalizeScores, calculateOpportunityScore } from '@/lib/opportunityScoring';
import { OPPORTUNITY_STATUSES, SCORE_KEYS, normalizeScores, calculateOpportunityScore } from '@/lib/opportunityScoring';
const opportunities = createRepository('ProductOpportunity');
const drafts = createRepository('OpportunityProductDraft');

const dedupPart = (value) => String(value || '').toLocaleLowerCase('pt-BR').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').slice(0, 180);
const opportunityDedupKey = (data = {}) => data.metadata?.dedup_key || `manual:${dedupPart(data.source || 'unknown')}:${dedupPart(data.source_url || data.title || data.description || 'opportunity')}`;

export const opportunityFoundationService = {
  list: (companyId) => opportunities.list(companyId, '-created_date'),
  create: async (companyId, data = {}) => {
    const dedupKey = opportunityDedupKey(data);
    const metadata = { ...(data.metadata || {}), dedup_key: dedupKey };
    const existing = (await opportunities.list(companyId, '-created_date', 500)).find((row) => row.metadata?.dedup_key === dedupKey);
    if (existing) {
      const mergedEvidence = [...(existing.metadata?.evidence || []), ...(metadata.evidence || [])].filter((item, index, all) => {
        const key = item?.url || JSON.stringify(item); return all.findIndex((candidate) => (candidate?.url || JSON.stringify(candidate)) === key) === index;
      }).slice(-20);
      return opportunities.update(existing.id, { ...data, metadata: { ...existing.metadata, ...metadata, evidence: mergedEvidence }, status: existing.status || data.status || OPPORTUNITY_STATUSES.DISCOVERY }, companyId);
    }
    return opportunities.create({ ...data, status: data.status || OPPORTUNITY_STATUSES.DISCOVERY, scores: normalizeScores(data.scores), opportunity_score: calculateOpportunityScore(data.scores), supplier_score: Number(data.supplier_score || 0), trust_score: Number(data.trust_score || 0), channel_score: Number(data.channel_score || 0), metadata }, companyId);
  },
  update: (companyId, id, data) => opportunities.update(id, { ...data, ...(data.scores ? { scores: normalizeScores(data.scores), opportunity_score: calculateOpportunityScore(data.scores) } : {}) }, companyId),
  remove: (companyId, id) => opportunities.remove(id, companyId),
  promote: async (companyId, opportunity, product = {}) => drafts.create({ company_id: companyId, opportunity_id: opportunity.id, name: product.name || opportunity.title, description: product.description || opportunity.description || '', category: product.category || '', price: Number(product.price || 0), cost: Number(product.cost || 0), stock: 0, active: false, status: 'draft' }, companyId),
  drafts: (companyId) => drafts.list(companyId, '-created_date'),
};
