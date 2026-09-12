import http from 'node:http';
import { createClient } from '@supabase/supabase-js';

const port = Number(process.env.MASTER_ADMIN_PORT || 8787);
const token = process.env.MASTER_ADMIN_LOCAL_TOKEN;
const supabaseUrl = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!token || !supabaseUrl || !serviceKey) throw new Error('Configure MASTER_ADMIN_LOCAL_TOKEN, SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY em ambiente local.');

const admin = createClient(supabaseUrl, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': 'http://localhost:5173', 'Access-Control-Allow-Headers': 'x-master-admin-token, content-type' });
  res.end(JSON.stringify(body));
}
async function readTable(table, columns, options = {}) {
  let query = admin.from(table).select(columns, options.selectOptions || {});
  if (options.order) query = query.order(options.order.column, { ascending: false });
  if (options.limit) query = query.limit(options.limit);
  const result = await query;
  return { data: result.data || [], count: result.count || 0, error: result.error };
}
const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return json(res, 204, {});
  if (req.headers['x-master-admin-token'] !== token) return json(res, 401, { error: 'unauthorized' });
  if (req.method !== 'GET' || req.url !== '/overview') return json(res, 404, { error: 'not_found' });
  try {
    const [companies, memberships, subscriptions, integrations, aiSettings, logs] = await Promise.all([
      readTable('companies', 'id,name,created_at', { order: { column: 'created_at' }, limit: 500 }),
      readTable('company_users', 'id,company_id,user_id,active,role'),
      readTable('company_subscriptions', 'company_id,plan,status'),
      readTable('company_integrations', 'company_id,provider,status'),
      readTable('ai_settings', 'company_id,enabled,auto_reply'),
      readTable('integration_logs', 'company_id,status,created_at', { order: { column: 'created_at' }, limit: 1000 }),
    ]);
    const firstError = [companies, memberships, subscriptions, integrations, aiSettings, logs].find((entry) => entry.error);
    if (firstError) throw firstError.error;
    const planByCompany = new Map(subscriptions.data.map((row) => [row.company_id, row]));
    const membersByCompany = new Map();
    memberships.data.forEach((row) => membersByCompany.set(row.company_id, (membersByCompany.get(row.company_id) || 0) + (row.active ? 1 : 0)));
    const integrationsByCompany = new Map();
    integrations.data.forEach((row) => integrationsByCompany.set(`${row.company_id}:${row.provider}`, row));
    const aiByCompany = new Map(aiSettings.data.map((row) => [row.company_id, row]));
    const companiesWithData = companies.data.map((company) => ({ ...company, plan: planByCompany.get(company.id)?.plan || 'free', status: planByCompany.get(company.id)?.status || 'unknown', user_count: membersByCompany.get(company.id) || 0, whatsapp_status: integrationsByCompany.get(`${company.id}:whatsapp`)?.status || 'disabled', ai_enabled: Boolean(aiByCompany.get(company.id)?.enabled), auto_reply: Boolean(aiByCompany.get(company.id)?.auto_reply) }));
    const activeStatuses = new Set(['active', 'trial']);
    const metrics = { companies: companies.data.length, activeCompanies: companiesWithData.filter((company) => activeStatuses.has(company.status)).length, users: memberships.data.filter((row) => row.active).length, whatsapp: integrations.data.filter((row) => row.provider === 'whatsapp' && ['connected', 'enabled', 'active'].includes(row.status)).length, ai: aiSettings.data.filter((row) => row.enabled).length, errors: logs.data.filter((row) => ['error', 'failed'].includes(String(row.status).toLowerCase())).length };
    return json(res, 200, { metrics, companies: companiesWithData });
  } catch (error) {
    return json(res, 500, { error: 'admin_query_failed', message: String(error?.message || 'query failed').slice(0, 160) });
  }
});
server.listen(port, '127.0.0.1', () => console.log(`F7 Master Admin API local listening on http://127.0.0.1:${port}`));
