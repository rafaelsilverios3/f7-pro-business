import { createRepository } from '@/data/repositoryFactory';
import { getDataProvider } from '@/data/providerSelector';
import { ACTIVITY_TYPES, validateActivityInput, crmActivityHelpers } from '@/lib/crmActivities';

const repository = createRepository('CrmActivity');

const pageResult = async (companyId, filters = {}, options = {}) => {
  const page = Math.max(1, Number(options.page) || 1); const pageSize = Math.min(200, Math.max(1, Number(options.pageSize) || 50));
  const entity = getDataProvider().entity('CrmActivity');
  if (typeof entity.listPage === 'function') return entity.listPage({ company_id: companyId, ...filters }, options.sort || '-due_at', page, pageSize);
  const rows = await repository.list(companyId, options.sort || '-due_at', 500);
  const filtered = rows.filter((row) => Object.entries(filters).every(([key, value]) => row[key] === value));
  return { rows: filtered.slice((page - 1) * pageSize, page * pageSize), count: filtered.length, page, pageSize };
};

export const crmActivitiesService = {
  async listActivities(companyId, filters = {}, options = {}) { return pageResult(companyId, filters, options); },
  async listPendingActivities(companyId, options = {}) { return pageResult(companyId, { status: 'PENDENTE' }, { sort: 'due_at', ...options }); },
  async listOverdueActivities(companyId, now = new Date(), options = {}) { return pageResult(companyId, { status: 'PENDENTE', due_at: { lt: now.toISOString() } }, { sort: 'due_at', ...options }); },
  async listCustomerActivities(companyId, customerId, options = {}) { return pageResult(companyId, { customer_id: customerId }, { sort: '-created_at', ...options }); },
  async listOpportunityActivities(companyId, opportunityId, options = {}) { return pageResult(companyId, { opportunity_id: opportunityId }, { sort: '-created_at', ...options }); },
  async listAssignedActivities(companyId, userId, options = {}) { return pageResult(companyId, { assigned_to: userId }, { sort: 'due_at', ...options }); },
  async createActivity(companyId, input) {
    const payload = validateActivityInput({ ...input, activity_type: input?.activity_type || 'tarefa' });
    if (!ACTIVITY_TYPES.includes(payload.activity_type)) throw new Error('Tipo de atividade inválido.');
    return repository.create({ ...payload, status: 'PENDENTE' }, companyId);
  },
  async updateActivity(companyId, id, input) { return repository.update(id, validateActivityInput(input), companyId); },
  async completeActivity(companyId, id) { return repository.update(id, { status: 'CONCLUIDA', completed_at: new Date().toISOString(), cancelled_at: null }, companyId); },
  async cancelActivity(companyId, id) { return repository.update(id, { status: 'CANCELADA', cancelled_at: new Date().toISOString(), completed_at: null }, companyId); },
  async rescheduleActivity(companyId, id, dueAt) { if (!dueAt || !Number.isFinite(crmActivityHelpers.dateTime(dueAt))) throw new Error('Data e hora inválidas.'); return repository.update(id, { due_at: dueAt, status: 'PENDENTE', completed_at: null, cancelled_at: null }, companyId); },
  async listMembers(companyId) { return (await getDataProvider().listMembers(companyId)).filter((member) => member.active !== false); },
};
