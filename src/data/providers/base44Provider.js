import { base44 } from '@/api/base44Client';

export const base44Provider = {
  entity(name) {
    const entity = base44.entities[name];
    if (!entity) throw new Error(`Entidade Base44 não configurada: ${name}`);
    if (typeof entity.listPage !== 'function') entity.listPage = async (filters = {}, sort = '-created_at', page = 1, pageSize = 50) => { const rows = await entity.filter(filters, sort, 500); const safePage = Math.max(1, Number(page) || 1); const safeSize = Math.min(200, Math.max(1, Number(pageSize) || 50)); return { rows: rows.slice((safePage - 1) * safeSize, safePage * safeSize), count: rows.length, page: safePage, pageSize: safeSize }; };
    return entity;
  },
  async rpc(name, params) {
    if (!base44.functions?.invoke) throw new Error(`RPC não disponível no Base44: ${name}`);
    return base44.functions.invoke(name, params);
  },
  async listMembers() { return base44.entities.User.list(); },
};
