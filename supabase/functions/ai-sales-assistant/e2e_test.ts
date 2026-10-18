import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.115.0';
import { handleAiSalesAssistantRequest } from './index.ts';

const baseUrl = Deno.env.get('SUPABASE_URL') || '';
const anonKey = Deno.env.get('SUPABASE_ANON_KEY') || '';
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const dbContainer = Deno.env.get('E2E_DB_CONTAINER') || '';
const local = new URL(baseUrl);
if (!['localhost', '127.0.0.1', '[::1]'].includes(local.hostname) || !anonKey || !serviceKey || !dbContainer) {
  throw new Error('AI Sales E2E requires an explicitly configured local-only Supabase stack.');
}

const admin = createClient(baseUrl, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
const originalEnv = new Map(['AI_ENABLED', 'AI_MAINTENANCE_MODE', 'AI_API_KEY', 'AI_API_URL', 'AI_MODEL'].map((key) => [key, Deno.env.get(key)]));
const createdUsers: string[] = [];
const createdCompanies: string[] = [];
let testRateVersion = '';
let testModelKey = '';
const providerRequests: Array<{ body: string; authorization: string | null }> = [];
let providerMode: 'success' | 'unavailable' = 'success';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function checked<T>(operation: PromiseLike<{ data: T; error: unknown }>, label: string): Promise<T> {
  const result = await operation;
  if (result.error) throw new Error(`${label} failed`);
  return result.data;
}

async function localSql(sql: string): Promise<string> {
  const result = await new Deno.Command('docker', {
    args: ['exec', dbContainer, 'psql', '-X', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'postgres', '-Atc', sql],
    stdout: 'piped', stderr: 'piped',
  }).output();
  if (result.code !== 0) throw new Error('Local PostgreSQL assertion failed.');
  return new TextDecoder().decode(result.stdout).trim();
}

async function resetLocalRateWindow(companyId: string, userId: string, metric = 'ai-sales-assistant') {
  // Keep the commercial-tool assertions independent of the production rate
  // limit; the limiter has its own dedicated bounded test below.
  await localSql(`delete from public.integration_rate_limits where company_id='${companyId}' and user_id='${userId}' and metric='${metric}'`);
}

async function makeUser(label: string) {
  const marker = crypto.randomUUID();
  const email = `ai-sales-${label}-${marker}@example.invalid`;
  const password = `${crypto.randomUUID()}!Aa9`;
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error || !created.data.user) throw new Error('Local Auth fixture creation failed.');
  createdUsers.push(created.data.user.id);
  const client = createClient(baseUrl, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const signedIn = await client.auth.signInWithPassword({ email, password });
  if (signedIn.error || !signedIn.data.session) throw new Error('Local Auth password session failed.');
  return { id: created.data.user.id, jwt: signedIn.data.session.access_token, client, marker };
}

async function makeCompany(owner: Awaited<ReturnType<typeof makeUser>>, label: string) {
  const created = await owner.client.rpc('create_company_with_owner', { company_name: `AI Sales E2E ${label} ${owner.marker.slice(0, 8)}` });
  if (created.error || !created.data?.id) throw new Error('Local company fixture creation failed.');
  const companyId = created.data.id as string;
  createdCompanies.push(companyId);
  await localSql(`update public.company_subscriptions set plan='pro', status='active', current_period_start=now(), current_period_end=now()+interval '1 day' where company_id='${companyId}'`);
  await checked(owner.client.from('company_assistant_settings').upsert({ company_id: companyId, max_daily_ai_calls: 50, max_tokens_per_request: 12000, max_daily_ai_cost: 100, ai_budget_currency: 'BRL' }), 'local budget setup');
  return companyId;
}

function invoke(jwt: string, companyId: string, body: Record<string, unknown>, providerFetch?: typeof fetch) {
  return handleAiSalesAssistantRequest(new Request('http://127.0.0.1/functions/v1/ai-sales-assistant', {
    method: 'POST',
    headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ company_id: companyId, ...body }),
  }), providerFetch ? { providerFetch } : {});
}

function mockProviderFetch(): typeof fetch {
  return async (_input, init) => {
    const body = String(init?.body || '');
    const authorization = new Headers(init?.headers).get('Authorization');
    providerRequests.push({ body, authorization });
    if (providerMode === 'unavailable') return new Response(JSON.stringify({ error: { code: 'synthetic_unavailable' } }), { status: 503 });
    const request = JSON.parse(body);
    const prompt = String(request.messages?.[1]?.content || '');
    const facts = prompt.match(/RESPOSTA FACTUAL A PRESERVAR:\n<tenant_data>([\s\S]*?)<\/tenant_data>/)?.[1] || 'Consulta concluída com dados fictícios.';
    return new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({ answer: facts, follow_up: '' }) } }],
      usage: { prompt_tokens: 1800, completion_tokens: 32 },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
}

async function createOffer(adminUser: Awaited<ReturnType<typeof makeUser>>, companyId: string, supplierId: string, productId: string, input: {
  cost: number; currency?: string; quantity?: number | null; observedAt: string; validUntil: string; endState?: 'approved' | 'suspended' | 'expired';
}) {
  const created = await adminUser.client.rpc('create_supplier_offer', {
    p_company_id: companyId, p_supplier_id: supplierId, p_product_id: productId,
    p_unit_cost: input.cost, p_currency: input.currency || 'BRL', p_supplier_quantity: input.quantity ?? null,
    p_minimum_order_quantity: 5, p_lead_time_days: 4, p_source_type: 'manual',
    p_source_note: 'Fixture sintética automatizada.', p_observed_at: input.observedAt, p_valid_until: input.validUntil,
  });
  if (created.error || !created.data?.id) throw new Error('Supplier Offer workflow creation failed.');
  const id = created.data.id as string;
  const pending = await adminUser.client.rpc('transition_supplier_offer', { p_offer_id: id, p_next_status: 'pending_verification', p_note: null });
  if (pending.error) throw new Error('Supplier Offer verification workflow failed.');
  if (input.endState === 'expired') {
    const expired = await adminUser.client.rpc('transition_supplier_offer', { p_offer_id: id, p_next_status: 'expired', p_note: null });
    if (expired.error) throw new Error('Supplier Offer expiration workflow failed.');
    return id;
  }
  if (input.endState === 'suspended') {
    const suspended = await adminUser.client.rpc('transition_supplier_offer', { p_offer_id: id, p_next_status: 'suspended', p_note: 'Suspensão de fixture E2E.' });
    if (suspended.error) throw new Error('Supplier Offer suspension workflow failed.');
    return id;
  }
  const verified = await adminUser.client.rpc('transition_supplier_offer', { p_offer_id: id, p_next_status: 'verified', p_note: 'Verificação de fixture E2E.' });
  if (verified.error) throw new Error('Supplier Offer verification transition failed.');
  const approved = await adminUser.client.rpc('transition_supplier_offer', { p_offer_id: id, p_next_status: 'approved', p_note: 'Aprovação humana sintética E2E.' });
  if (approved.error) throw new Error('Supplier Offer approval transition failed.');
  return id;
}

Deno.test('AI Sales: Auth real local, ferramentas comerciais/RLS, mock de geração, ledger 0089 e confirmação humana', async () => {
  const previousProvider = Deno.env.get('AI_API_URL');
  Deno.env.set('AI_MAINTENANCE_MODE', 'false');
  Deno.env.set('AI_ENABLED', 'true');
  Deno.env.set('AI_API_KEY', 'local-e2e-dummy-key');
  Deno.env.set('AI_API_URL', 'https://api.openai.com/v1/chat/completions');
  testModelKey = `local-e2e-${crypto.randomUUID()}`;
  Deno.env.set('AI_MODEL', testModelKey);
  providerRequests.length = 0;
  providerMode = 'success';

  let companyA = '';
  let companyB = '';
  let ownerA: Awaited<ReturnType<typeof makeUser>> | undefined;
  let ownerB: Awaited<ReturnType<typeof makeUser>> | undefined;
  let sellerA: Awaited<ReturnType<typeof makeUser>> | undefined;
  let productId = '';
  let draftIdempotencyKey = '';

  try {
    const options = await handleAiSalesAssistantRequest(new Request('http://127.0.0.1/functions/v1/ai-sales-assistant', { method: 'OPTIONS', headers: { Origin: 'http://localhost:55431' } }));
    assert(options.status === 200 && options.headers.get('Access-Control-Allow-Methods')?.includes('POST') === true, 'local CORS preflight failed');
    ownerA = await makeUser('admin-a');
    ownerB = await makeUser('admin-b');
    sellerA = await makeUser('seller-a');
    companyA = await makeCompany(ownerA, 'A');
    companyB = await makeCompany(ownerB, 'B');

    // Membership writes are intentionally restricted to server-side provisioning;
    // seed this local-only test identity with service_role, then test every AI
    // request as the seller's real Supabase Auth JWT below.
    await checked(admin.from('company_users').insert({ company_id: companyA, user_id: sellerA.id, role: 'vendedor', active: true }), 'local seller membership');

    const product = await checked(ownerA.client.from('products').insert({ company_id: companyA, name: 'Produto fictício AI Sales', sku: `E2E-${ownerA.marker.slice(0, 8)}`, cost: 30, price: 99.95, stock: 20, minimum_stock: 2, active: true }).select('id,sku').single(), 'local product fixture');
    assert(product, 'local product fixture returned no row');
    productId = product.id;
    const supplier = await checked(ownerA.client.from('suppliers').insert({ company_id: companyA, name: 'Fornecedor fictício AI Sales' }).select('id').single(), 'local supplier fixture');
    assert(supplier, 'local supplier fixture returned no row');
    await checked(ownerA.client.from('supplier_intelligence_profiles').insert({ company_id: companyA, supplier_id: supplier.id, supplier_score: 81, trust_score: 80, trust_label: 'baixo risco aparente', data_confidence: 75 }), 'local supplier intelligence fixture');
    const customer = await checked(ownerA.client.from('customers').insert({ company_id: companyA, name: 'Cliente Fictício E2E', email: `privacy-${ownerA.marker}@example.invalid`, phone: '+5500000000000', total_purchased: 120, sale_count: 2, avg_ticket: 60 }).select('id').single(), 'local customer fixture');
    assert(customer, 'local customer fixture returned no row');
    await checked(ownerA.client.from('opportunities').insert({ company_id: companyA, customer_id: customer.id, title: 'Oportunidade fictícia AI Sales', stage: 'new', value: 100 }), 'local opportunity fixture');
    const channel = await checked(ownerA.client.from('sales_channels').insert({ company_id: companyA, name: 'Canal E2E', channel_type: 'marketplace', status: 'disconnected', connected: false }).select('id').single(), 'local channel fixture');
    assert(channel, 'local channel fixture returned no row');
    await checked(ownerA.client.from('product_channel_links').insert({ company_id: companyA, product_id: productId, channel_id: channel.id, status: 'draft', fee_rate: 14.5 }), 'local channel fee fixture');

    const today = new Date().toISOString().slice(0, 10);
    const future = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
    const old = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
    const eligibleOfferId = await createOffer(ownerA, companyA, supplier.id, productId, { cost: 42.5, quantity: 12, observedAt: today, validUntil: future });
    await createOffer(ownerA, companyA, supplier.id, productId, { cost: 35, currency: 'USD', quantity: 20, observedAt: today, validUntil: future });
    await createOffer(ownerA, companyA, supplier.id, productId, { cost: 38, quantity: 10, observedAt: old, validUntil: old, endState: 'expired' });
    await createOffer(ownerA, companyA, supplier.id, productId, { cost: 39, quantity: 10, observedAt: today, validUntil: future, endState: 'suspended' });
    await createOffer(ownerA, companyA, supplier.id, productId, { cost: 40, quantity: null, observedAt: today, validUntil: future });
    assert(eligibleOfferId.length > 0, 'eligible offer was not created');

    testRateVersion = `local-e2e-${ownerA.marker}`;
    const rateSql = `insert into public.ai_rate_cards(rate_kind,provider_key,model_key,rate_version,currency,input_cost_per_1k,output_cost_per_1k,source_reference,verified_at,approved_by,effective_from,enabled) values ('model_tokens','https://api.openai.com','${testModelKey}','${testRateVersion}','BRL',1,2,'local synthetic test rate',now(), '${ownerA.id}', now() - interval '1 minute', true)`;
    await localSql(rateSql);

    const statusResponse = await invoke(ownerA.jwt, companyA, { action: 'status' });
    const statusBody = await statusResponse.json();
    assert(statusResponse.status === 200 && statusBody.can_use === true, 'authorized local Admin A did not receive allowed status');
    assert(statusBody.controls?.tenant_membership === true && statusBody.controls?.entitlement === 'ai_sales', 'status omitted server authorization controls');

    const requestId = crypto.randomUUID();
    const offerResponse = await invoke(ownerA.jwt, companyA, { message: `Compare ofertas de fornecedor para o SKU ${product.sku}; solicito 8 unidades`, request_id: requestId }, mockProviderFetch());
    const offerBody = await offerResponse.json();
    assert(offerResponse.status === 200 && offerBody.tool === 'analisar_ofertas_fornecedor', `supplier offers tool failed through the real handler (http=${offerResponse.status}, code=${String(offerBody.code || 'none').slice(0, 60)}, tool=${String(offerBody.tool || 'none').slice(0, 60)})`);
    if (offerBody.generation_mode !== 'ai_generated') {
      const diag = await localSql(`select coalesce((select status from public.ai_budget_reservations where company_id='${companyA}' and request_key='${requestId}:ai-sales'),'no_reservation') || '|' || (select count(*)::text from public.ai_rate_cards where rate_version='${testRateVersion}') || '|' || (select count(*)::text from public.ai_rate_cards where rate_kind='model_tokens' and provider_key='https://api.openai.com' and model_key='${testModelKey}' and enabled and effective_from<=now() and (effective_until is null or effective_until>now()))`);
      throw new Error(`mocked provider generation did not complete (mode=${String(offerBody.generation_mode)}, status_mode=${String(statusBody.generation_mode)}, budget=${String(statusBody.controls?.company_ai_budget)}, mock_calls=${providerRequests.length}, data_chars=${JSON.stringify(offerBody.data || null).length}, local_reservation_and_rate=${diag})`);
    }
    assert(offerBody.data?.offers?.length === 1 && offerBody.data.offers[0].request_covered_by_declaration === true, 'eligible BRL offer was not used');
    assert(offerBody.data.offers[0].channels?.[0]?.fee_source === 'internal_configuration_unverified_by_marketplace', 'channel fee origin was not disclosed');
    assert(offerBody.data.contextual_offers.some((offer: any) => offer.currency === 'USD'), 'foreign currency offer was not kept contextual');
    assert(offerBody.data.contextual_offers.some((offer: any) => offer.status === 'expired'), 'expired offer was not excluded from commercial simulation');
    assert(offerBody.data.contextual_offers.some((offer: any) => offer.status === 'suspended'), 'suspended offer was not excluded from commercial simulation');
    assert(offerBody.data.contextual_offers.some((offer: any) => offer.quantity_status === 'unknown'), 'unknown supplier availability was not kept contextual');
    const settled = await localSql(`select status || '|' || actual_input_tokens || '|' || actual_output_tokens || '|' || (actual_cost_microunits <= reserved_cost_microunits)::text from public.ai_budget_reservations where company_id='${companyA}' and request_key='${requestId}:ai-sales'`);
    assert(settled === 'settled|1800|32|true', 'successful mock response did not reconcile provider metrics against the real local 0089 ledger');

    const shortage = await invoke(ownerA.jwt, companyA, { message: `Compare ofertas de fornecedor para o SKU ${product.sku}; solicito 15 unidades`, request_id: crypto.randomUUID() }, mockProviderFetch());
    const shortageBody = await shortage.json();
    assert(shortage.status === 200 && shortageBody.data.offers.length === 0, 'insufficient declared availability was treated as eligible');
    assert(shortageBody.data.contextual_offers.some((offer: any) => offer.quantity_status === 'insufficient' && offer.shortfall === 3), 'supplier quantity shortfall was not reported');

    const beforeFailure = providerRequests.length;
    providerMode = 'unavailable';
    const providerFailureKey = crypto.randomUUID();
    const fallback = await invoke(ownerA.jwt, companyA, { message: `Compare ofertas de fornecedor para o SKU ${product.sku}; solicito 8 unidades`, request_id: providerFailureKey }, mockProviderFetch());
    const fallbackBody = await fallback.json();
    assert(fallback.status === 200 && fallbackBody.generation_mode === 'factual_fallback', 'provider failure did not preserve safe factual response');
    const uncertain = await localSql(`select status || '|' || coalesce(safe_reason_code,'') from public.ai_budget_reservations where company_id='${companyA}' and request_key='${providerFailureKey}:ai-sales'`);
    assert(uncertain.startsWith('uncertain|'), 'ambiguous provider failure did not retain the reservation conservatively');
    assert(providerRequests.length === beforeFailure + 1, 'only the explicit synthetic provider mock should have been called');
    assert(providerRequests.at(-1)?.authorization === 'Bearer local-e2e-dummy-key', 'local dummy API key was not isolated to the provider mock');

    providerMode = 'success';
    const customerResponse = await invoke(ownerA.jwt, companyA, { message: 'Procure o cliente Cliente Fictício E2E', request_id: crypto.randomUUID() }, mockProviderFetch());
    const customerBody = await customerResponse.json();
    assert(customerResponse.status === 200 && customerBody.tool === 'buscar_cliente', 'customer search tool did not execute');
    const providerCustomerRequest = providerRequests.at(-1)?.body || '';
    assert(!providerCustomerRequest.includes(`privacy-${ownerA.marker}@example.invalid`) && !providerCustomerRequest.includes('+5500000000000'), 'customer PII reached the provider mock payload');

    Deno.env.set('AI_ENABLED', 'false');
    const factualStatus = await invoke(ownerA.jwt, companyA, { action: 'status' });
    const factualStatusBody = await factualStatus.json();
    assert(factualStatus.status === 200 && factualStatusBody.can_use === true && factualStatusBody.generation_mode === 'factual_only', 'authorized company did not remain available in factual-only mode when generation was disabled');
    const factualCallsBefore = providerRequests.length;
    const factualRequestId = crypto.randomUUID();
    const factualStock = await invoke(ownerA.jwt, companyA, { message: `Quanto temos em estoque do SKU ${product.sku}?`, request_id: factualRequestId });
    const factualStockBody = await factualStock.json();
    assert(factualStock.status === 200 && factualStockBody.tool === 'consultar_estoque' && factualStockBody.generation_mode === 'factual_fallback' && factualStockBody.data.stock === 20, 'authorized commercial lookup did not return a grounded factual answer with generation disabled');
    assert(providerRequests.length === factualCallsBefore, 'factual-only lookup unexpectedly called the provider mock');
    const factualReservation = await localSql(`select count(*)::text from public.ai_budget_reservations where company_id='${companyA}' and request_key='${factualRequestId}:ai-sales'`);
    assert(factualReservation === '0', 'factual-only lookup unexpectedly reserved paid AI budget');

    const sellerOffer = await invoke(sellerA.jwt, companyA, { message: `Compare ofertas de fornecedor para o SKU ${product.sku}`, request_id: crypto.randomUUID() });
    assert(sellerOffer.status === 403 && (await sellerOffer.json()).code === 'TOOL_PERMISSION_DENIED', 'seller could access an ungranted purchase/pricing tool');
    const sellerStock = await invoke(sellerA.jwt, companyA, { message: `Quanto temos em estoque do SKU ${product.sku}?`, request_id: crypto.randomUUID() });
    const sellerStockBody = await sellerStock.json();
    assert(sellerStock.status === 200 && sellerStockBody.tool === 'consultar_estoque', 'seller could not access the permitted stock tool');
    const crossTenant = await invoke(ownerB.jwt, companyA, { message: `Quais produtos temos?`, request_id: crypto.randomUUID() });
    assert(crossTenant.status === 403 && (await crossTenant.json()).code === 'FORBIDDEN', 'Admin B crossed into Empresa A');

    const inventory = await invoke(ownerA.jwt, companyA, { message: `Quanto temos em estoque do SKU ${product.sku}?`, request_id: crypto.randomUUID() });
    const inventoryBody = await inventory.json();
    assert(inventory.status === 200 && inventoryBody.tool === 'consultar_estoque' && inventoryBody.data.stock === 20, 'real stock tool returned wrong data');
    const price = await invoke(ownerA.jwt, companyA, { message: `Qual o preço do SKU ${product.sku}?`, request_id: crypto.randomUUID() });
    assert(price.status === 200 && (await price.json()).tool === 'consultar_preco', 'real catalog price tool did not execute');
    const opportunities = await invoke(ownerA.jwt, companyA, { message: 'Quais oportunidades comerciais tenho hoje?', request_id: crypto.randomUUID() });
    const opportunitiesBody = await opportunities.json();
    assert(opportunities.status === 200 && opportunitiesBody.tool === 'buscar_oportunidades', `opportunity tool failed (http=${opportunities.status}, code=${String(opportunitiesBody.code || 'none')}, tool=${String(opportunitiesBody.tool || 'none')})`);
    const suppliers = await invoke(ownerA.jwt, companyA, { message: 'Quais perfis de fornecedores tenho?', request_id: crypto.randomUUID() });
    assert(suppliers.status === 200 && (await suppliers.json()).tool === 'consultar_fornecedor', 'supplier intelligence tool did not execute');
    const channels = await invoke(ownerA.jwt, companyA, { message: 'Quais canais comerciais estão configurados?', request_id: crypto.randomUUID() });
    const channelsBody = await channels.json();
    assert(channels.status === 200 && channelsBody.tool === 'consultar_canais', `sales channel tool failed (http=${channels.status}, code=${String(channelsBody.code || 'none')}, tool=${String(channelsBody.tool || 'none')})`);

    await resetLocalRateWindow(companyA, ownerA.id);
    const baseline = await checked(ownerA.client.from('products').select('stock').eq('id', productId).eq('company_id', companyA).single(), 'stock baseline');
    assert(baseline, 'stock baseline unavailable');
    const beforeResults = await Promise.all([
      ownerA.client.from('sales').select('id', { count: 'exact', head: true }).eq('company_id', companyA),
      ownerA.client.from('stock_movements').select('id', { count: 'exact', head: true }).eq('company_id', companyA),
      ownerA.client.from('financial_entries').select('id', { count: 'exact', head: true }).eq('company_id', companyA),
    ]);
    assert(beforeResults.every((result) => !result.error), 'could not read local commercial baselines');
    const countsBeforeDraft = { sales: beforeResults[0].count || 0, movements: beforeResults[1].count || 0, financial: beforeResults[2].count || 0 };
    const draftPreview = await invoke(ownerA.jwt, companyA, { message: `Crie um rascunho de 2 unidades para o SKU ${product.sku}`, request_id: crypto.randomUUID() });
    const draftPreviewBody = await draftPreview.json();
    assert(draftPreview.status === 200 && draftPreviewBody.actions?.can_create_draft === true, 'draft preview did not require human confirmation');
    draftIdempotencyKey = crypto.randomUUID();
    const deniedDraft = await invoke(ownerA.jwt, companyA, { action: 'create_draft', confirmed: false, draft: { product_id: productId, quantity: 2, idempotency_key: draftIdempotencyKey } });
    const deniedDraftBody = await deniedDraft.json();
    assert(deniedDraft.status === 409 && deniedDraftBody.code === 'CONFIRMATION_REQUIRED', `draft confirmation gate failed (http=${deniedDraft.status}, code=${String(deniedDraftBody.code || 'none')})`);
    const confirmedDraft = await invoke(ownerA.jwt, companyA, { action: 'create_draft', confirmed: true, draft: { product_id: productId, quantity: 2, idempotency_key: draftIdempotencyKey } });
    const confirmedBody = await confirmedDraft.json();
    assert(confirmedDraft.status === 200 && confirmedBody.draft?.status === 'draft', 'confirmed draft did not use the official RPC');
    const finalProduct = await checked(ownerA.client.from('products').select('stock').eq('id', productId).eq('company_id', companyA).single(), 'stock final');
    assert(finalProduct, 'stock final unavailable');
    const afterResults = await Promise.all([
      ownerA.client.from('sales').select('id', { count: 'exact', head: true }).eq('company_id', companyA),
      ownerA.client.from('stock_movements').select('id', { count: 'exact', head: true }).eq('company_id', companyA),
      ownerA.client.from('financial_entries').select('id', { count: 'exact', head: true }).eq('company_id', companyA),
    ]);
    assert(afterResults.every((result) => !result.error), 'could not read local commercial final state');
    const countsAfterDraft = { sales: afterResults[0].count || 0, movements: afterResults[1].count || 0, financial: afterResults[2].count || 0 };
    assert(finalProduct.stock === baseline.stock, 'creating a draft changed own stock');
    assert(countsAfterDraft.sales === countsBeforeDraft.sales + 1 && countsAfterDraft.movements === countsBeforeDraft.movements && countsAfterDraft.financial === countsBeforeDraft.financial, 'draft produced unexpected commercial side effects');

    await resetLocalRateWindow(companyA, ownerA.id);
    for (let index = 0; index < 10; index++) {
      const allowedRead = await invoke(ownerA.jwt, companyA, { message: 'Quais produtos temos?', request_id: crypto.randomUUID() });
      assert(allowedRead.status === 200, `local rate-limit request ${index + 1} was unexpectedly blocked`);
    }
    const rateLimited = await invoke(ownerA.jwt, companyA, { message: 'Quais produtos temos?', request_id: crypto.randomUUID() });
    const rateLimitedBody = await rateLimited.json();
    assert(rateLimited.status === 429 && rateLimitedBody.code === 'RATE_LIMITED', `11th request rate-limit result differed (http=${rateLimited.status}, code=${String(rateLimitedBody.code || 'none')})`);

    const runsBeforeMaintenance = await ownerA.client.from('ai_runs').select('id', { count: 'exact', head: true }).eq('company_id', companyA);
    if (runsBeforeMaintenance.error) throw new Error('maintenance run baseline failed');
    const countersBeforeMaintenance = await localSql(`select coalesce(string_agg(metric || ':' || count::text, ',' order by metric),'') from public.usage_counters where company_id='${companyA}'`);
    Deno.env.set('AI_MAINTENANCE_MODE', 'true');
    const maintenance = await invoke(ownerA.jwt, companyA, { action: 'status' });
    const maintenanceBody = await maintenance.json();
    assert(maintenance.status === 503 && maintenanceBody.code === 'AI_MAINTENANCE', 'maintenance did not return the expected safe block');
    const runsAfterMaintenance = await ownerA.client.from('ai_runs').select('id', { count: 'exact', head: true }).eq('company_id', companyA);
    if (runsAfterMaintenance.error) throw new Error('maintenance run final failed');
    const countersAfterMaintenance = await localSql(`select coalesce(string_agg(metric || ':' || count::text, ',' order by metric),'') from public.usage_counters where company_id='${companyA}'`);
    assert(runsAfterMaintenance.count === runsBeforeMaintenance.count, 'maintenance started a new commercial AI run');
    assert(countersAfterMaintenance === countersBeforeMaintenance, 'maintenance consumed paid AI budget');
    assert(providerRequests.length === beforeFailure + 2, 'maintenance or factual-only tools unexpectedly called the provider mock');
  } finally {
    Deno.env.set('AI_MAINTENANCE_MODE', originalEnv.get('AI_MAINTENANCE_MODE') || '');
    Deno.env.set('AI_ENABLED', originalEnv.get('AI_ENABLED') || '');
    Deno.env.set('AI_API_KEY', originalEnv.get('AI_API_KEY') || '');
    Deno.env.set('AI_API_URL', previousProvider || originalEnv.get('AI_API_URL') || '');
    Deno.env.set('AI_MODEL', originalEnv.get('AI_MODEL') || '');
    const cleanupFailures: string[] = [];
    if (createdCompanies.length) {
      const cleanup = await localSql(`delete from public.companies where id in (${createdCompanies.map((id) => `'${id}'`).join(',')})`).then(() => true).catch(() => false);
      if (!cleanup) cleanupFailures.push('companies');
    }
    if (testRateVersion) {
      const escaped = testRateVersion.replaceAll("'", "''");
      const cleanup = await localSql(`delete from public.ai_rate_cards where rate_version='${escaped}'`).then(() => true).catch(() => false);
      if (!cleanup) cleanupFailures.push('rate_card');
    }
    for (const userId of createdUsers) {
      const deleted = await admin.auth.admin.deleteUser(userId);
      if (deleted.error) cleanupFailures.push('auth_user');
    }
    if (cleanupFailures.length) throw new Error(`Local AI Sales fixture cleanup failed (${[...new Set(cleanupFailures)].join(',')}).`);
  }
});
