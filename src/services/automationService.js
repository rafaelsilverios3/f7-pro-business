import { createRepository } from '@/data/repositoryFactory';
import { opportunityRadarService } from '@/services/opportunityRadarService';
const automations = createRepository('Automation');
const runs = createRepository('AutomationRun');
export const automationService = {
  list: (companyId) => automations.list(companyId, '-created_at'),
  listRuns: (companyId) => runs.list(companyId, '-created_at'),
  create: (companyId, data) => automations.create(data, companyId),
  update: (companyId, id, data) => automations.update(id, data, companyId),
  remove: (companyId, id) => automations.remove(id, companyId),
  async runNow(companyId, automation) {
    // General automation execution remains AUTOMATION_SERVER_SIDE_ONLY.
    if (!companyId || !automation?.active) throw new Error('AUTOMATION_NOT_ACTIVE');
    // The current production worker is event-driven and has no scheduler. A
    // manual run is therefore limited to the safe Radar detectors and never
    // executes transactional actions.
    if (!['client_inactive', 'stock_below_min'].includes(automation.trigger_type)) throw new Error('AUTOMATION_MANUAL_RUN_UNSUPPORTED');
    const result = await opportunityRadarService.scan(companyId);
    return { status: 'completed', automation_id: automation.id, detector: automation.trigger_type, ...result };
  },
  run: (companyId, automation) => automationService.runNow(companyId, automation),
};
