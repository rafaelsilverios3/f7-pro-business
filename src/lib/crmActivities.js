export const ACTIVITY_TYPES = Object.freeze(['ligacao', 'whatsapp', 'email', 'reuniao', 'visita', 'proposta', 'retorno', 'tarefa', 'outro']);
export const ACTIVITY_TYPE_LABELS = Object.freeze({ ligacao: 'Ligação', whatsapp: 'WhatsApp', email: 'E-mail', reuniao: 'Reunião', visita: 'Visita', proposta: 'Proposta', retorno: 'Retorno', tarefa: 'Tarefa', outro: 'Outro' });
export const ACTIVITY_STATUSES = Object.freeze(['PENDENTE', 'CONCLUIDA', 'CANCELADA']);
export const ACTIVITY_STATUS_LABELS = Object.freeze({ PENDENTE: 'Pendente', CONCLUIDA: 'Concluída', CANCELADA: 'Cancelada' });

const dateTime = (value) => value ? new Date(value).getTime() : NaN;

export function isPending(activity) { return activity?.status === 'PENDENTE'; }
export function isOverdue(activity, now = new Date()) { return isPending(activity) && Number.isFinite(dateTime(activity.due_at)) && dateTime(activity.due_at) < dateTime(now); }
export function isDueToday(activity, now = new Date()) {
  if (!isPending(activity) || !activity?.due_at) return false;
  const due = new Date(activity.due_at); const current = new Date(now);
  return due.getFullYear() === current.getFullYear() && due.getMonth() === current.getMonth() && due.getDate() === current.getDate();
}
/** @param {{title?: unknown, activity_type?: unknown, description?: unknown, due_at?: unknown, [key: string]: unknown}} input @returns {{title: string, activity_type: string, description: string | null, due_at: unknown, [key: string]: unknown}} */
export function validateActivityInput(input = {}) {
  const title = String(input.title || '').trim();
  if (!title) throw new Error('Informe um título para a atividade.');
  if (typeof input.activity_type !== 'string' || !ACTIVITY_TYPES.includes(input.activity_type)) throw new Error('Tipo de atividade inválido.');
  if (input.due_at && !Number.isFinite(dateTime(input.due_at))) throw new Error('Data e hora inválidas.');
  return { ...input, activity_type: input.activity_type, title, description: String(input.description || '').trim() || null, due_at: input.due_at || null };
}
export function deriveNextAction(activities = [], now = new Date()) {
  return activities.filter(isPending).filter((row) => row.due_at && Number.isFinite(dateTime(row.due_at))).sort((a, b) => dateTime(a.due_at) - dateTime(b.due_at))[0] || null;
}
export function activitySummary(activities = [], now = new Date()) {
  const pending = activities.filter(isPending);
  return { total: activities.length, pending: pending.length, overdue: pending.filter((row) => isOverdue(row, now)).length, due_today: pending.filter((row) => isDueToday(row, now)).length, completed: activities.filter((row) => row.status === 'CONCLUIDA').length, cancelled: activities.filter((row) => row.status === 'CANCELADA').length };
}
export function sortActivities(activities = [], status = 'PENDENTE') {
  return [...activities].filter((row) => !status || row.status === status).sort((a, b) => {
    if (status === 'PENDENTE') return (dateTime(a.due_at) || Number.MAX_SAFE_INTEGER) - (dateTime(b.due_at) || Number.MAX_SAFE_INTEGER);
    return (dateTime(b.completed_at || b.cancelled_at || b.created_at) || 0) - (dateTime(a.completed_at || a.cancelled_at || a.created_at) || 0);
  });
}

export const crmActivityHelpers = { dateTime };
