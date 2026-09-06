import { base44Provider } from './providers/base44Provider';

const requireCompany = (companyId) => {
  if (!companyId) throw new Error('company_id é obrigatório.');
  return companyId;
};

export function createRepository(entityName) {
  return {
    async list(companyId, sort = '-created_date', limit = 500) {
      return base44Provider.entity(entityName).filter({ company_id: requireCompany(companyId) }, sort, limit);
    },
    async get(id, companyId) {
      const item = await base44Provider.entity(entityName).get(id);
      if (!item || item.company_id !== requireCompany(companyId)) throw new Error('Registro não encontrado.');
      return item;
    },
    async create(data, companyId) {
      const id = requireCompany(companyId);
      return base44Provider.entity(entityName).create({ ...data, company_id: id });
    },
    async update(id, data, companyId) {
      const current = await this.get(id, companyId);
      const { company_id: _ignored, ...safeData } = data || {};
      return base44Provider.entity(entityName).update(current.id, safeData);
    },
    async remove(id, companyId) {
      const current = await this.get(id, companyId);
      return base44Provider.entity(entityName).delete(current.id);
    },
  };
}
