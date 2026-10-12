import {
  COMPANIES,
  isUuid,
  result,
  safeApiFailure,
  validateOperationSession,
} from '../runnerConfig';

const OFFER_MARKER = /^F7_HOMOLOG_OFFER_A_[A-F0-9]{32}$/;

function blocked(identity, company, operation, detail) {
  return result(identity, company, 'supplier_offers', operation, 'precondições verificadas', 'BLOCKED', null, detail);
}

function deniedResult(guard, operation, error, expected) {
  const failure = safeApiFailure(error);
  const message = String(error?.message || '');
  const explicitRoleDenial = /sem permissão para gerenciar ofertas|permissão insuficiente|permission denied/i.test(message);
  const pass = failure.denied || explicitRoleDenial;
  return {
    row: result(guard.identity.label, guard.identity.company, 'supplier_offers', operation, expected,
      pass ? 'PASS' : 'PENDING', failure.status, pass
        ? `negado pelo servidor${failure.code ? ` (${failure.code})` : ''}`
        : `negação não comprovada${failure.code ? ` (${failure.code})` : ''}`),
    denied: pass,
  };
}

async function readOperationalSnapshot(supabase, companyId, productId) {
  const [product, movements, purchaseItems, finance] = await Promise.all([
    supabase.from('products').select('id,stock').eq('id', productId).eq('company_id', companyId).maybeSingle(),
    supabase.from('stock_movements').select('id', { count: 'exact', head: true }).eq('company_id', companyId).eq('product_id', productId),
    supabase.from('purchase_items').select('id', { count: 'exact', head: true }).eq('company_id', companyId).eq('product_id', productId),
    supabase.from('financial_entries').select('id', { count: 'exact', head: true }).eq('company_id', companyId),
  ]);
  if ([product, movements, purchaseItems, finance].some((response) => response.error)
    || !product.data || !Number.isFinite(Number(product.data.stock))) return null;
  return {
    stock: Number(product.data.stock),
    stockMovements: Number(movements.count || 0),
    purchaseItems: Number(purchaseItems.count || 0),
    financialEntries: Number(finance.count || 0),
  };
}

export async function runSupplierOffersReadChecks(supabase) {
  const guard = await validateOperationSession(supabase, ['admin', 'vendedor']);
  if (guard.error) return [blocked('Sessão atual', '—', 'REST SELECT preflight', guard.error)];

  if (guard.identity.label === 'Admin B') {
    const { count, error, status } = await supabase.from('supplier_offers')
      .select('id', { count: 'exact', head: true }).eq('company_id', COMPANIES.A.id);
    if (error) return [result(guard.identity.label, 'B', 'supplier_offers', 'REST HEAD cross-tenant', 'zero ofertas da Empresa A visíveis', 'PENDING', status ?? error.status ?? null, `consulta inconclusiva${error.code ? ` (${error.code})` : ''}`)];
    const visible = Number(count || 0);
    return [result(guard.identity.label, 'B', 'supplier_offers', 'REST HEAD cross-tenant', 'zero ofertas da Empresa A visíveis', visible === 0 ? 'PASS' : 'FAIL', status ?? 200, `linhas visíveis=${visible}`)];
  }

  if (guard.identity.label === 'Vendedor A') {
    const { count, error, status } = await supabase.from('supplier_offers')
      .select('id', { count: 'exact', head: true }).eq('company_id', guard.ownCompany.id);
    if (error) return [result(guard.identity.label, 'A', 'supplier_offers', 'REST HEAD own-tenant', 'zero ofertas visíveis ao vendedor', 'PENDING', status ?? error.status ?? null, `consulta inconclusiva${error.code ? ` (${error.code})` : ''}`)];
    const visible = Number(count || 0);
    return [result(guard.identity.label, 'A', 'supplier_offers', 'REST HEAD own-tenant', 'zero ofertas visíveis ao vendedor', visible === 0 ? 'PASS' : 'FAIL', status ?? 200, `linhas visíveis=${visible}`)];
  }

  const { count, error, status } = await supabase.from('supplier_offers')
    .select('id', { count: 'exact', head: true }).eq('company_id', guard.ownCompany.id);
  if (error) return [result(guard.identity.label, 'A', 'supplier_offers', 'REST HEAD own-tenant', 'consulta autenticada concluída', 'PENDING', status ?? error.status ?? null, `consulta inconclusiva${error.code ? ` (${error.code})` : ''}`)];
  return [result(guard.identity.label, 'A', 'supplier_offers', 'REST HEAD own-tenant', 'consulta autenticada concluída', 'PASS', status ?? 200, `ofertas próprias=${Number(count || 0)}`)];
}

export async function prepareSupplierOfferFixture(supabase) {
  const guard = await validateOperationSession(supabase, ['admin']);
  if (guard.error || guard.identity.label !== 'Admin A') {
    return { rows: [blocked(guard.identity?.label || 'Sessão atual', guard.identity?.company || '—', 'prepare disposable fixture', guard.error || 'somente Admin A pode preparar a fixture')] };
  }

  const [supplierResult, productResult] = await Promise.all([
    supabase.from('suppliers').select('id').eq('company_id', COMPANIES.A.id).order('created_at').limit(1).maybeSingle(),
    supabase.from('products').select('id').eq('company_id', COMPANIES.A.id).order('created_at').limit(1).maybeSingle(),
  ]);
  if (supplierResult.error || productResult.error || !supplierResult.data?.id || !productResult.data?.id) {
    return { rows: [blocked('Admin A', 'A', 'fixture prerequisites', 'não foi possível validar fornecedor e produto próprios; nenhuma oferta criada')] };
  }

  const nonce = crypto.randomUUID().replaceAll('-', '').toUpperCase();
  const marker = `F7_HOMOLOG_OFFER_A_${nonce}`;
  const { count, error: duplicateError } = await supabase.from('supplier_offers')
    .select('id', { count: 'exact', head: true }).eq('company_id', COMPANIES.A.id).eq('source_note', marker);
  if (duplicateError || Number(count || 0) !== 0) {
    return { rows: [blocked('Admin A', 'A', 'fixture uniqueness preflight', 'marcador não pôde ser validado como único; nenhuma oferta criada')] };
  }

  const baseline = await readOperationalSnapshot(supabase, COMPANIES.A.id, productResult.data.id);
  if (!baseline) return { rows: [blocked('Admin A', 'A', 'fixture operational baseline', 'estoque/ledger indisponível; nenhuma oferta criada')] };

  const observedAt = new Date().toISOString().slice(0, 10);
  const validUntilDate = new Date(`${observedAt}T00:00:00.000Z`);
  validUntilDate.setUTCDate(validUntilDate.getUTCDate() + 30);
  const validUntil = validUntilDate.toISOString().slice(0, 10);
  const { data, error, status } = await supabase.rpc('create_supplier_offer', {
    p_company_id: COMPANIES.A.id,
    p_supplier_id: supplierResult.data.id,
    p_product_id: productResult.data.id,
    p_unit_cost: 0.01,
    p_currency: 'BRL',
    p_supplier_quantity: 1,
    p_minimum_order_quantity: 1,
    p_lead_time_days: 1,
    p_source_type: 'manual',
    p_source_url: null,
    p_source_note: marker,
    p_observed_at: observedAt,
    p_valid_until: validUntil,
  });
  const offer = Array.isArray(data) ? data[0] : data;
  if (error || !offer?.id || offer.company_id !== COMPANIES.A.id || offer.status !== 'draft'
    || offer.source_note !== marker || offer.product_id !== productResult.data.id) {
    return { rows: [result('Admin A', 'A', 'create_supplier_offer', 'create disposable test fixture', 'uma oferta fictícia em rascunho', 'FAIL', status ?? error?.status ?? null, `criação não confirmada${error?.code ? ` (${error.code})` : ''}; resposta bruta omitida`)] };
  }

  const after = await readOperationalSnapshot(supabase, COMPANIES.A.id, productResult.data.id);
  const unchanged = after && JSON.stringify(after) === JSON.stringify(baseline);
  const fixture = {
    id: offer.id,
    marker,
    productId: productResult.data.id,
    supplierId: supplierResult.data.id,
    companyId: COMPANIES.A.id,
    baseline,
    expected: { status: 'draft', unitCost: 0.01, currency: 'BRL', sourceNote: marker },
  };
  return {
    fixture,
    rows: [
      result('Admin A', 'A', 'create_supplier_offer', 'create disposable test fixture', 'uma oferta fictícia em rascunho', unchanged ? 'PASS' : 'FAIL', status ?? 200, `fixture criada por RPC; id=${offer.id}; marcador=${marker}; persistirá como registro fictício de teste`),
      result('Admin A', 'A', 'products/stock_movements/purchase_items/financial_entries', 'fixture operational baseline', 'sem alteração operacional', unchanged ? 'PASS' : 'FAIL', 200, unchanged ? 'estoque e contagens operacionais inalterados' : 'estado operacional mudou durante a criação; interrompa a suíte'),
    ],
  };
}

function zeroRowsResult(guard, operation, status, error, expected) {
  const failure = safeApiFailure(error);
  const noRows = !error && (status === 200 || status === 204);
  const pass = failure.denied || noRows;
  const detail = failure.denied
    ? `negado pela API${failure.code ? ` (${failure.code})` : ''}`
    : noRows ? 'HTTP sem linha afetada; registro oculto/não modificado' : `resposta inconclusiva${failure.code ? ` (${failure.code})` : ''}`;
  return { row: result(guard.identity.label, 'A', 'supplier_offers', operation, expected, pass ? 'PASS' : 'PENDING', failure.status ?? status ?? null, detail), pass };
}

export async function runSellerSupplierOfferChecks(supabase, { fixtureId, marker }) {
  const checks = [];
  let guard = await validateOperationSession(supabase, ['vendedor']);
  if (guard.error || guard.identity.label !== 'Vendedor A' || guard.identity.company !== 'A') {
    return [blocked(guard.identity?.label || 'Sessão atual', guard.identity?.company || '—', 'Seller A suite preflight', guard.error || 'Vendedor A é obrigatório')];
  }
  if (!isUuid(fixtureId) || !OFFER_MARKER.test(String(marker || '').trim())) {
    return [blocked('Vendedor A', 'A', 'disposable fixture validation', 'informe o ID e marcador da fixture fictícia recém-criada por Admin A')];
  }

  const { count: ownOfferCount, error: ownReadError, status: ownReadStatus } = await supabase.from('supplier_offers')
    .select('id', { count: 'exact', head: true }).eq('company_id', guard.ownCompany.id);
  if (ownReadError || Number(ownOfferCount || 0) !== 0) {
    return [result('Vendedor A', 'A', 'supplier_offers', 'REST HEAD own-tenant', 'zero ofertas visíveis', ownReadError ? 'PENDING' : 'FAIL', ownReadStatus ?? ownReadError?.status ?? 200, ownReadError ? 'leitura inconclusiva; nenhuma tentativa de escrita realizada' : `linhas visíveis=${Number(ownOfferCount || 0)}; escritas interrompidas`)];
  }
  checks.push(result('Vendedor A', 'A', 'supplier_offers', 'REST HEAD own-tenant', 'zero ofertas visíveis', 'PASS', ownReadStatus ?? 200, 'nenhuma oferta da Empresa A visível ao vendedor'));

  const [supplierResult, productResult] = await Promise.all([
    supabase.from('suppliers').select('id').eq('company_id', guard.ownCompany.id).order('created_at').limit(1).maybeSingle(),
    supabase.from('products').select('id').eq('company_id', guard.ownCompany.id).order('created_at').limit(1).maybeSingle(),
  ]);
  if (supplierResult.error || productResult.error || !supplierResult.data?.id || !productResult.data?.id) {
    checks.push(blocked('Vendedor A', 'A', 'write-test prerequisites', 'não foi possível validar IDs fictícios próprios; nenhuma tentativa de escrita realizada'));
    return checks;
  }

  guard = await validateOperationSession(supabase, ['vendedor']);
  if (guard.error) return [...checks, blocked('Vendedor A', 'A', 'REST INSERT revalidation', guard.error)];
  const insert = await supabase.from('supplier_offers').insert({
    company_id: guard.ownCompany.id,
    supplier_id: supplierResult.data.id,
    product_id: productResult.data.id,
    unit_cost: 0.01,
    currency: 'BRL',
    supplier_quantity: 1,
    minimum_order_quantity: 1,
    lead_time_days: 1,
    source_type: 'manual',
    source_note: `${marker}_SELLER_INSERT_ATTEMPT`,
    observed_at: new Date().toISOString().slice(0, 10),
  }).select('id');
  const insertDenied = safeApiFailure(insert.error);
  if (insertDenied.denied) {
    checks.push(result('Vendedor A', 'A', 'supplier_offers', 'REST INSERT own-tenant', 'negação server-side; nenhuma oferta criada', 'PASS', insertDenied.status, `negado${insertDenied.code ? ` (${insertDenied.code})` : ''}`));
  } else {
    checks.push(result('Vendedor A', 'A', 'supplier_offers', 'REST INSERT own-tenant', 'nenhuma oferta criada', insert.error ? 'PENDING' : 'FAIL', insertDenied.status ?? insert.status ?? null, insert.error ? `erro não conclusivo${insertDenied.code ? ` (${insertDenied.code})` : ''}; sequência interrompida` : `API aceitou a operação; linhas=${insert.data?.length ?? 0}; sequência interrompida`));
    return checks;
  }

  guard = await validateOperationSession(supabase, ['vendedor']);
  if (guard.error) return [...checks, blocked('Vendedor A', 'A', 'REST PATCH revalidation', guard.error)];
  const patch = await supabase.from('supplier_offers').update({ source_note: `${marker}_PATCH_ATTEMPT` })
    .eq('id', fixtureId).eq('company_id', guard.ownCompany.id).eq('source_note', marker).select('id');
  const patchResult = zeroRowsResult(guard, 'REST PATCH disposable fixture', patch.status, patch.error, 'negado ou zero linhas; fixture intacta');
  checks.push(patchResult.row);
  if (!patchResult.pass) return checks;

  guard = await validateOperationSession(supabase, ['vendedor']);
  if (guard.error) return [...checks, blocked('Vendedor A', 'A', 'REST DELETE revalidation', guard.error)];
  const deletion = await supabase.from('supplier_offers').delete()
    .eq('id', fixtureId).eq('company_id', guard.ownCompany.id).eq('source_note', marker).select('id');
  const deleteResult = zeroRowsResult(guard, 'REST DELETE disposable fixture', deletion.status, deletion.error, 'negado ou zero linhas; fixture intacta');
  checks.push(deleteResult.row);
  if (!deleteResult.pass) return checks;

  const createMarker = `${marker}_RPC_CREATE_ATTEMPT`;
  guard = await validateOperationSession(supabase, ['vendedor']);
  if (guard.error) return [...checks, blocked('Vendedor A', 'A', 'create_supplier_offer revalidation', guard.error)];
  const create = await supabase.rpc('create_supplier_offer', {
    p_company_id: guard.ownCompany.id,
    p_supplier_id: supplierResult.data.id,
    p_product_id: productResult.data.id,
    p_unit_cost: 0.01,
    p_currency: 'BRL',
    p_supplier_quantity: 1,
    p_minimum_order_quantity: 1,
    p_lead_time_days: 1,
    p_source_type: 'manual',
    p_source_note: createMarker,
    p_observed_at: new Date().toISOString().slice(0, 10),
  });
  const createResult = deniedResult(guard, 'RPC create_supplier_offer', create.error, 'negação explícita por falta de papel autorizado');
  checks.push(createResult.row);
  if (!createResult.denied) return checks;

  guard = await validateOperationSession(supabase, ['vendedor']);
  if (guard.error) return [...checks, blocked('Vendedor A', 'A', 'update_supplier_offer revalidation', guard.error)];
  const update = await supabase.rpc('update_supplier_offer', {
    p_offer_id: fixtureId,
    p_supplier_id: supplierResult.data.id,
    p_product_id: productResult.data.id,
    p_unit_cost: 99.99,
    p_currency: 'BRL',
    p_supplier_quantity: 1,
    p_minimum_order_quantity: 1,
    p_lead_time_days: 1,
    p_source_type: 'manual',
    p_source_note: `${marker}_RPC_UPDATE_ATTEMPT`,
    p_observed_at: new Date().toISOString().slice(0, 10),
    p_valid_until: null,
  });
  const updateResult = deniedResult(guard, 'RPC update_supplier_offer', update.error, 'negação explícita; fixture permanece inalterada');
  checks.push(updateResult.row);
  if (!updateResult.denied) return checks;

  guard = await validateOperationSession(supabase, ['vendedor']);
  if (guard.error) return [...checks, blocked('Vendedor A', 'A', 'transition_supplier_offer revalidation', guard.error)];
  const transition = await supabase.rpc('transition_supplier_offer', {
    p_offer_id: fixtureId,
    p_next_status: 'approved',
    p_note: 'Tentativa controlada de aprovação por vendedor sem autorização.',
  });
  const transitionResult = deniedResult(guard, 'RPC transition_supplier_offer (approve)', transition.error, 'negação explícita; estado continua draft');
  checks.push(transitionResult.row);
  return checks;
}

export async function verifySupplierOfferFixture(supabase, fixture) {
  const guard = await validateOperationSession(supabase, ['admin']);
  if (guard.error || guard.identity.label !== 'Admin A' || guard.identity.company !== 'A') {
    return [blocked(guard.identity?.label || 'Sessão atual', guard.identity?.company || '—', 'owner fixture verification', guard.error || 'retorne à sessão proprietária Admin A')];
  }
  if (!fixture?.id || fixture.companyId !== COMPANIES.A.id) {
    return [blocked('Admin A', 'A', 'owner fixture verification', 'fixture desta sessão não encontrada; não será usado acesso administrativo alternativo')];
  }
  const { data: offer, error, status } = await supabase.from('supplier_offers')
    .select('id,company_id,supplier_id,product_id,unit_cost,currency,status,source_note')
    .eq('id', fixture.id).eq('company_id', fixture.companyId).eq('source_note', fixture.marker).maybeSingle();
  if (error || !offer) return [result('Admin A', 'A', 'supplier_offers', 'owner verify test fixture', 'mesma fixture draft, sem mutação', 'PENDING', status ?? error?.status ?? null, `fixture não confirmada${error?.code ? ` (${error.code})` : ''}`)];
  const fieldsUnchanged = offer.status === fixture.expected.status
    && Number(offer.unit_cost) === fixture.expected.unitCost
    && offer.currency === fixture.expected.currency
    && offer.source_note === fixture.expected.sourceNote
    && offer.supplier_id === fixture.supplierId
    && offer.product_id === fixture.productId;
  const snapshot = await readOperationalSnapshot(supabase, fixture.companyId, fixture.productId);
  const operationsUnchanged = snapshot && JSON.stringify(snapshot) === JSON.stringify(fixture.baseline);
  return [
    result('Admin A', 'A', 'supplier_offers', 'owner verify test fixture', 'fixture segue draft e sem alterações', fieldsUnchanged ? 'PASS' : 'FAIL', status ?? 200, fieldsUnchanged ? `id=${fixture.id}; status=draft; source_note preservada` : 'campos divergentes; evidência preservada'),
    result('Admin A', 'A', 'products/stock_movements/purchase_items/financial_entries', 'owner verify operational snapshot', 'estoque e dados operacionais inalterados', operationsUnchanged ? 'PASS' : snapshot ? 'FAIL' : 'PENDING', 200, operationsUnchanged ? 'estoque, movimentos, compras e financeiro iguais ao baseline' : 'snapshot divergente ou indisponível; evidência preservada'),
  ];
}
