import { getSupabaseClient } from '@/data/providers/supabaseProvider';

const supabaseOnly = () => {
  if (import.meta.env.VITE_DATA_PROVIDER !== 'supabase') throw new Error('Produção requer o provedor Supabase.');
  return getSupabaseClient();
};

export const productionService = {
  async list(companyId) {
    const client = supabaseOnly();
    const [{ data: recipes, error: recipeError }, { data: items, error: itemError }] = await Promise.all([
      client.from('production_recipes').select('*').eq('company_id', companyId).order('updated_at', { ascending: false }),
      client.from('production_recipe_items').select('*').eq('company_id', companyId).order('position', { ascending: true }),
    ]);
    if (recipeError) throw recipeError;
    if (itemError) throw itemError;
    return (recipes || []).map((recipe) => ({ ...recipe, items: (items || []).filter((item) => item.recipe_id === recipe.id) }));
  },
  async recentOrders(companyId) {
    const { data, error } = await supabaseOnly().from('production_orders').select('*').eq('company_id', companyId).order('created_at', { ascending: false }).limit(20);
    if (error) throw error;
    return data || [];
  },
  async saveRecipe(companyId, payload) {
    const { data, error } = await supabaseOnly().rpc('save_production_recipe', { recipe_payload: { ...payload, company_id: companyId } });
    if (error) throw error;
    return data;
  },
  async produce(companyId, recipeId, quantity) {
    const { data, error } = await supabaseOnly().rpc('complete_production_order', { order_payload: { company_id: companyId, recipe_id: recipeId, quantity: Number(quantity) } });
    if (error) throw error;
    return data;
  },
};
