import { base44Provider } from '@/data/providers/base44Provider';
export async function writeAuditLog({ companyId, userId, action, entity, entityId, oldData, newData }) {
  try { return await base44Provider.entity('AuditLog').create({ company_id: companyId, user_id: userId || null, action, entity, entity_id: entityId, old_data: oldData || null, new_data: newData || null, created_at: new Date().toISOString() }); } catch { return null; }
}
