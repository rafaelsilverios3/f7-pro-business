import { createRepository } from '@/data/repositoryFactory';
import { opportunityRadarService } from '@/services/opportunityRadarService';
import { invokeEdgeFunction } from '@/services/integrationsService';
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
    if (!['client_inactive', 'stock_below_min'].includes(automation.trigger_type)) throw new Error('AUTOMATION_MANUAL_RUN_UNSUPPORTED');
    if (import.meta.env.VITE_DATA_PROVIDER === 'supabase') return invokeEdgeFunction('automation-worker', { company_id: companyId, automation_id: automation.id, trigger_type: automation.trigger_type, event_id: `manual:${automation.id}:${new Date().toISOString()}`, trigger: 'MANUAL', event_data: { manual: true } });
    const result = await opportunityRadarService.scan(companyId);
    return { status: 'completed', automation_id: automation.id, detector: automation.trigger_type, ...result };
  },
  run: (companyId, automation) => automationService.runNow(companyId, automation),
};
