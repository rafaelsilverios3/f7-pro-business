export type AutomationCondition = { field: string; operator: 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte' | 'contains'; value: unknown };
export type AutomationAction = { type: string; params?: Record<string, unknown> };

const READ_ONLY_ACTIONS = new Set(['notify', 'create_notification']);
const SENSITIVE_ACTIONS = new Set(['create_task', 'follow_up', 'create_opportunity', 'assign_seller', 'change_status', 'create_sale', 'decrement_stock', 'create_financial_entry', 'approve_credit', 'create_purchase']);

function fieldValue(data: Record<string, unknown>, field: string) {
  if (!/^[a-zA-Z0-9_]{1,80}$/.test(field)) return undefined;
  return data[field];
}

export function matchesAutomationConditions(eventData: Record<string, unknown>, conditions: unknown) {
  if (conditions == null || (Array.isArray(conditions) && conditions.length === 0)) return true;
  if (!Array.isArray(conditions) || conditions.length > 20) return false;
  return conditions.every((raw) => {
    const condition = raw as AutomationCondition;
    const actual = fieldValue(eventData, String(condition?.field || ''));
    const expected = condition?.value;
    switch (condition?.operator) {
      case 'eq': return String(actual) === String(expected);
      case 'ne': return String(actual) !== String(expected);
      case 'gt': return Number(actual) > Number(expected);
      case 'gte': return Number(actual) >= Number(expected);
      case 'lt': return Number(actual) < Number(expected);
      case 'lte': return Number(actual) <= Number(expected);
      case 'contains': return typeof actual === 'string' && actual.includes(String(expected));
      default: return false;
    }
  });
}

export function buildAutomationPlan(rule: any, input: { company_id: string; trigger_type: string; event_id: string; event_data?: Record<string, unknown> }) {
  if (!input.company_id || !input.event_id || input.event_id.length > 160) throw new Error('INVALID_AUTOMATION_EVENT');
  if (rule?.company_id !== input.company_id || rule?.active !== true || rule?.trigger_type !== input.trigger_type) return { status: 'ignored', reason: 'rule_not_applicable', actions: [] };
  if (!matchesAutomationConditions(input.event_data || {}, rule.conditions)) return { status: 'skipped', reason: 'conditions_not_met', actions: [] };
  const actions = Array.isArray(rule.actions) ? rule.actions.slice(0, 10) : [];
  const planned = actions.map((action: AutomationAction) => ({ type: String(action?.type || '').slice(0, 80), params: action?.params && typeof action.params === 'object' && !Array.isArray(action.params) ? action.params : {}, execution: READ_ONLY_ACTIONS.has(action?.type) ? 'allowed' : SENSITIVE_ACTIONS.has(action?.type) ? 'requires_explicit_authorization' : 'unsupported' }));
  return { status: planned.some((action) => action.execution === 'allowed') ? 'ready' : 'blocked', reason: planned.some((action) => action.execution === 'allowed') ? 'policy_passed' : 'no_authorized_action', actions: planned };
}
