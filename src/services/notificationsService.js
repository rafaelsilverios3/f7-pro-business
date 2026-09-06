import { createRepository } from '@/data/repositoryFactory';
const repository = createRepository('Notification');
export const notificationsService = {
  list: (companyId) => repository.list(companyId, '-created_at'),
  markRead: (companyId, id) => repository.update(id, { read: true }, companyId),
  markAllRead: async (companyId, items) => Promise.all(items.filter((item) => !item.read).map((item) => repository.update(item.id, { read: true }, companyId))),
  remove: (companyId, id) => repository.remove(id, companyId),
};
