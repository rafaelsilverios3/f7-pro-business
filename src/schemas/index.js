import { z } from 'zod';
export const saleItemSchema = z.object({ product_id: z.string().min(1), name: z.string().optional(), qty: z.coerce.number().positive(), price: z.coerce.number().nonnegative(), cost: z.coerce.number().nonnegative().optional() });
export const customerSchema = z.object({ company_id: z.string().min(1), name: z.string().trim().min(1), email: z.string().email().optional().or(z.literal('')), document: z.string().optional() });
export const productSchema = z.object({ company_id: z.string().min(1), name: z.string().trim().min(1), sku: z.string().optional(), price: z.coerce.number().nonnegative(), cost: z.coerce.number().nonnegative(), stock: z.coerce.number().nonnegative() });
export const saleSchema = z.object({ company_id: z.string().min(1), items: z.array(saleItemSchema).min(1), discount: z.coerce.number().nonnegative().optional(), addition: z.coerce.number().nonnegative().optional() });
export const financeSchema = z.object({ company_id: z.string().min(1), type: z.enum(['receivable', 'payable']), amount: z.coerce.number().positive(), due_date: z.string().min(1) });
