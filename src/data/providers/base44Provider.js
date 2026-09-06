import { base44 } from '@/api/base44Client';

export const base44Provider = {
  entity(name) {
    const entity = base44.entities[name];
    if (!entity) throw new Error(`Entidade Base44 não configurada: ${name}`);
    return entity;
  },
  async rpc(name, params) {
    if (!base44.functions?.invoke) throw new Error(`RPC não disponível no Base44: ${name}`);
    return base44.functions.invoke(name, params);
  },
};
