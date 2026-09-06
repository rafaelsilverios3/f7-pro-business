import { receivePurchase } from '@/lib/purchases';
import { getDataProvider } from '@/data/providerSelector';
export const purchasesService = { receive: (purchase) => import.meta.env.VITE_DATA_PROVIDER === 'supabase' ? getDataProvider().rpc('receive_purchase', { target_purchase: purchase.id }) : receivePurchase(purchase) };
