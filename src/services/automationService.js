import { createRepository } from '@/data/repositoryFactory';
const automations = createRepository('Automation');
const runs = createRepository('AutomationRun');
export const automationService = {
  list: (companyId) => automations.list(companyId, '-created_at'),
  listRuns: (companyId) => runs.list(companyId, '-created_at'),
  create: (companyId, data) => automations.create(data, companyId),
  update: (companyId, id, data) => automations.update(id, data, companyId),
  remove: (companyId, id) => automations.remove(id, companyId),
  async run() { throw new Error('AUTOMATION_SERVER_SIDE_ONLY'); },
};
