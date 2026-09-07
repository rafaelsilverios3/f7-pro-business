import { createRepository } from '@/data/repositoryFactory';
export { OPPORTUNITY_STATUSES, SCORE_KEYS, normalizeScores, calculateOpportunityScore } from '@/lib/opportunityScoring';
import { OPPORTUNITY_STATUSES, SCORE_KEYS, normalizeScores } from '@/lib/opportunityScoring';
const opportunities = createRepository('ProductOpportunity');
const drafts = createRepository('OpportunityProductDraft');

export const opportunityFoundationService = {
  list: (companyId) => opportunities.list(companyId, '-created_date'),
  create: (companyId, data) => opportunities.create({ ...data, status: data.status || OPPORTUNITY_STATUSES.DISCOVERY, scores: normalizeScores(data.scores), metadata: data.metadata || {} }, companyId),
  update: (companyId, id, data) => opportunities.update(id, { ...data, ...(data.scores ? { scores: normalizeScores(data.scores) } : {}) }, companyId),
  remove: (companyId, id) => opportunities.remove(id, companyId),
  promote: async (companyId, opportunity, product = {}) => drafts.create({ company_id: companyId, opportunity_id: opportunity.id, name: product.name || opportunity.title, description: product.description || opportunity.description || '', category: product.category || '', price: Number(product.price || 0), cost: Number(product.cost || 0), stock: 0, active: false, status: 'draft' }, companyId),
  drafts: (companyId) => drafts.list(companyId, '-created_date'),
};
