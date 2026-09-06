import { base44 } from '@/api/base44Client';
import { createNotification } from '@/lib/notifications';

const todayISO = () => new Date().toISOString().slice(0, 10);

export const TRIGGER_LABELS = {
  new_sale: 'Nova venda',
  new_lead: 'Novo lead',
  quote_created: 'Orçamento criado',
  quote_approved: 'Orçamento aprovado',
  quote_no_response: 'Orçamento sem resposta',
  stock_below_min: 'Estoque abaixo do mínimo',
  bill_due: 'Conta vencendo',
  bill_overdue: 'Conta vencida',
  client_inactive: 'Cliente inativo',
  goal_reached: 'Meta atingida',
};

export const ACTION_LABELS = {
  create_task: 'Criar tarefa',
  create_opportunity: 'Criar oportunidade',
  notify: 'Gerar notificação',
  assign_seller: 'Atribuir vendedor',
  change_status: 'Alterar status',
  follow_up: 'Registrar follow-up',
};

function matchesConditions(eventData, conditions) {
  if (!conditions || conditions.length === 0) return true;
  return conditions.every((cond) => {
    const val = eventData[cond.field];
    const target = cond.value;
    switch (cond.operator) {
      case 'eq': return String(val) === String(target);
      case 'ne': return String(val) !== String(target);
      case 'gt': return Number(val) > Number(target);
      case 'lt': return Number(val) < Number(target);
      case 'contains': return String(val || '').includes(String(target));
      default: return true;
    }
  });
}

async function executeAction(companyId, action, eventData) {
  const p = action.params || {};
  switch (action.type) {
    case 'create_task':
      return base44.entities.Task.create({
        company_id: companyId,
        title: p.title || `Tarefa automática — ${eventData.name || eventData.customer_name || ''}`,
        description: p.description || '',
        assignee: p.assignee || eventData.seller || '',
        due_date: p.due_date || '',
        status: 'pending',
        related_type: eventData._type || '',
        related_id: eventData.id || '',
      });
    case 'create_opportunity':
      return base44.entities.Opportunity.create({
        company_id: companyId,
        title: p.title || `Oportunidade — ${eventData.customer_name || eventData.name || ''}`,
        description: p.description || '',
        source: 'intelligence',
        customer_name: eventData.customer_name || '',
        value: Number(eventData.total || eventData.amount || 0),
        stage: 'new',
        assignee: p.assignee || eventData.seller || '',
      });
    case 'notify':
      return createNotification(companyId, {
        title: p.title || 'Notificação automática',
        message: p.message || '',
        type: p.notification_type || 'sale',
        priority: p.priority || 'medium',
        link: p.link || '',
      });
    case 'follow_up':
      return base44.entities.Task.create({
        company_id: companyId,
        title: `Follow-up — ${eventData.customer_name || eventData.name || ''}`,
        description: p.description || 'Follow-up automático',
        assignee: p.assignee || eventData.seller || '',
        due_date: todayISO(),
        status: 'pending',
        related_type: eventData._type || '',
        related_id: eventData.id || '',
      });
    default:
      return null;
  }
}

export async function runAutomations(companyId, trigger, eventData) {
  const automations = await base44.entities.Automation.filter({
    company_id: companyId, trigger, active: true,
  }, '-created_date', 100);

  const logs = [];
  for (const auto of automations) {
    if (!matchesConditions(eventData, auto.conditions)) {
      logs.push(base44.entities.AutomationLog.create({
        company_id: companyId,
        automation_id: auto.id,
        automation_name: auto.name,
        trigger,
        event_data: JSON.stringify({ name: eventData.name || eventData.customer_name, id: eventData.id }).slice(0, 500),
        status: 'skipped',
      }));
      continue;
    }
    try {
      for (const action of (auto.actions || [])) {
        await executeAction(companyId, action, eventData);
      }
      await base44.entities.Automation.update(auto.id, { last_run: new Date().toISOString() });
      logs.push(base44.entities.AutomationLog.create({
        company_id: companyId,
        automation_id: auto.id,
        automation_name: auto.name,
        trigger,
        event_data: JSON.stringify({ name: eventData.name || eventData.customer_name, id: eventData.id }).slice(0, 500),
        status: 'success',
      }));
    } catch (err) {
      logs.push(base44.entities.AutomationLog.create({
        company_id: companyId,
        automation_id: auto.id,
        automation_name: auto.name,
        trigger,
        event_data: JSON.stringify({ name: eventData.name || eventData.customer_name, id: eventData.id }).slice(0, 500),
        status: 'error',
        error_message: (err.message || '').slice(0, 500),
      }));
    }
  }
  await Promise.all(logs);
}