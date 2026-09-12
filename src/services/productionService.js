import { getSupabaseClient } from '@/data/providers/supabaseProvider';

const supabaseOnly = () => {
  if (import.meta.env.VITE_DATA_PROVIDER !== 'supabase') throw new Error('Produção requer o provedor Supabase.');
  return getSupabaseClient();
};

// Numeric inputs are held as strings while a recipe form is being edited.
// Never send an empty string to a PostgreSQL numeric cast: normalize it at
// the service boundary while preserving legitimate zero values.
const numberOr = (value, fallback = 0) => {
  if (value === '' || value === null || value === undefined) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

function normalizeRecipePayload(payload, companyId) {
  return {
    ...payload,
    company_id: companyId,
    yield_quantity: Math.max(0.001, numberOr(payload.yield_quantity, 1)),
    labor_cost: Math.max(0, numberOr(payload.labor_cost)),
    other_cost: Math.max(0, numberOr(payload.other_cost)),
    packaging_cost: Math.max(0, numberOr(payload.packaging_cost)),
    overhead_cost: Math.max(0, numberOr(payload.overhead_cost)),
    loss_percent: Math.min(100, Math.max(0, numberOr(payload.loss_percent))),
    items: Array.isArray(payload.items) ? payload.items.map((item, position) => ({
      ...item,
      quantity: numberOr(item.quantity),
      conversion_factor: Math.max(0.000001, numberOr(item.conversion_factor, 1)),
      position: numberOr(item.position, position),
    })) : [],
  };
}

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
    const { data, error } = await supabaseOnly().rpc('save_production_recipe', { recipe_payload: normalizeRecipePayload(payload, companyId) });
    if (error) throw error;
    return data;
  },
  async produce(companyId, recipeId, quantity) {
    const { data, error } = await supabaseOnly().rpc('complete_production_order', { order_payload: { company_id: companyId, recipe_id: recipeId, quantity: Math.max(0.001, numberOr(quantity, 1)) } });
    if (error) throw error;
    return data;
  },
};
