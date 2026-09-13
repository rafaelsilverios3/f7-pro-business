import { salesRepository } from '@/data/repositories/salesRepository';
import { productsRepository } from '@/data/repositories/productsRepository';
import { customersRepository } from '@/data/repositories/customersRepository';
import { financeRepository } from '@/data/repositories/financeRepository';
import { inventoryRepository } from '@/data/repositories/inventoryRepository';
import { purchasesRepository } from '@/data/repositories/purchasesRepository';
import { suppliersRepository } from '@/data/repositories/suppliersRepository';
import { commissionsRepository } from '@/data/repositories/commissionsRepository';
import { createPeriodContext } from '@/lib/metrics';

export const reportsService = {
  async load(companyId, periodContext) {
    if (!companyId) throw new Error('company_id é obrigatório para relatórios.');
    const [sales, products, customers, financials, movements, purchases, suppliers, commissions] = await Promise.all([
      salesRepository.list(companyId), productsRepository.list(companyId), customersRepository.list(companyId),
      financeRepository.list(companyId), inventoryRepository.list(companyId), purchasesRepository.list(companyId),
      suppliersRepository.list(companyId), commissionsRepository.list(companyId),
    ]);
    return { company_id: companyId, period: periodContext || createPeriodContext({ companyId, periodKey: 'month' }), sales, products, customers, fin: financials, movements, purchases, suppliers, commissions };
  },
};
