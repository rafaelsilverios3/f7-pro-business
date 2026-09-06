import { base44 } from '@/api/base44Client';

export async function createNotification(companyId, { title, message, type, priority, link }) {
  return base44.entities.Notification.create({
    company_id: companyId,
    title,
    message: message || '',
    type: type || 'sale',
    priority: priority || 'medium',
    link: link || '',
    read: false,
  });
}

export async function markNotificationRead(id) {
  return base44.entities.Notification.update(id, { read: true });
}

export async function markAllRead(companyId) {
  const unread = await base44.entities.Notification.filter({ company_id: companyId, read: false }, '-created_date', 200);
  if (unread.length === 0) return;
  await base44.entities.Notification.bulkUpdate(unread.map((n) => ({ id: n.id, read: true })));
}

export async function generateSystemNotifications(companyId, data) {
  const { products, financials, quotes, conversations } = data;
  const created = [];

  for (const p of products || []) {
    if ((p.stock || 0) <= (p.min_stock || 0) && p.active) {
      const exists = await base44.entities.Notification.filter({
        company_id: companyId, type: 'stock', read: false,
      }, '-created_date', 50);
      const already = exists.some((n) => n.title.includes(p.name));
      if (!already) {
        created.push(createNotification(companyId, {
          title: `Estoque crítico: ${p.name}`,
          message: `Apenas ${p.stock} ${p.unit || 'un'} em estoque (mínimo: ${p.min_stock}).`,
          type: 'stock', priority: 'high', link: '/estoque',
        }));
      }
    }
  }

  const today = new Date().toISOString().slice(0, 10);
  for (const f of financials || []) {
    if (f.status === 'pending' && f.due_date && f.due_date < today) {
      const exists = await base44.entities.Notification.filter({
        company_id: companyId, type: 'financial', read: false,
      }, '-created_date', 50);
      const already = exists.some((n) => n.title.includes(f.description));
      if (!already) {
        created.push(createNotification(companyId, {
          title: `Conta vencida: ${f.description}`,
          message: `Venceu em ${f.due_date}. Valor: R$ ${(f.amount || 0).toFixed(2)}.`,
          type: 'financial', priority: 'high', link: '/financeiro',
        }));
      }
    }
  }

  for (const q of quotes || []) {
    if (q.status === 'sent' && q.valid_until && q.valid_until < today) {
      const exists = await base44.entities.Notification.filter({
        company_id: companyId, type: 'quote', read: false,
      }, '-created_date', 50);
      const already = exists.some((n) => n.title.includes(q.customer_name));
      if (!already) {
        created.push(createNotification(companyId, {
          title: `Orçamento parado: ${q.customer_name}`,
          message: `Enviado e sem resposta. Validade expirou em ${q.valid_until}.`,
          type: 'quote', priority: 'medium', link: '/orcamentos',
        }));
      }
    }
  }

  for (const c of conversations || []) {
    if (c.status === 'waiting_human') {
      const exists = await base44.entities.Notification.filter({
        company_id: companyId, type: 'attendance', read: false,
      }, '-created_date', 50);
      const already = exists.some((n) => n.title.includes(c.customer_name));
      if (!already) {
        created.push(createNotification(companyId, {
          title: `Atendimento aguardando humano: ${c.customer_name}`,
          message: `A IA transferiu o atendimento. Necessita intervenção humana.`,
          type: 'attendance', priority: 'high', link: '/atendimento',
        }));
      }
    }
  }

  await Promise.all(created);
  return created.length;
}