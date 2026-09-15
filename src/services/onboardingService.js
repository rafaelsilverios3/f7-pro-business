const JOURNEY_DEFINITIONS = Object.freeze({
  commerce: { id: 'commerce', label: 'Comércio', description: 'Para empresas que compram produtos e revendem.' },
  services: { id: 'services', label: 'Serviços', description: 'Para empresas que vendem serviços ou atendimentos.' },
  production: { id: 'production', label: 'Produção', description: 'Para empresas que utilizam matérias-primas para produzir.' },
});

const common = [
  { id: 'dashboard', title: 'Conheça seu Dashboard', shortDescription: 'Veja os indicadores da sua operação em um só lugar.', whyItMatters: 'O Dashboard transforma os dados reais da empresa em uma visão rápida para decidir melhor.', route: '/f7probusiness', actionLabel: 'Abrir Dashboard', audience: ['commerce', 'services', 'production'], completionRule: 'seen', permission: 'dashboard.view', order: 1 },
  { id: 'customer', title: 'Cadastre seu primeiro cliente', shortDescription: 'Registre as pessoas ou empresas que compram de você.', whyItMatters: 'Clientes cadastrados podem ser usados em orçamentos, vendas e relacionamento.', route: '/clientes', actionLabel: 'Cadastrar cliente', audience: ['commerce', 'services', 'production'], completionRule: 'customer', permission: 'customers.view', order: 2 },
];

const definitions = Object.freeze({
  commerce: [...common, { id: 'product', title: 'Cadastre seu primeiro produto', shortDescription: 'O Catálogo reúne o que sua empresa vende.', whyItMatters: 'Produtos conectam preço, estoque, compras, orçamentos e vendas.', route: '/produtos', actionLabel: 'Cadastrar produto', audience: ['commerce'], completionRule: 'product', permission: 'products.view', order: 3 }, { id: 'pricing', title: 'Defina o preço de venda', shortDescription: 'Compare custo, preço de venda e margem.', whyItMatters: 'Um preço válido permite vender com clareza e acompanhar a margem.', route: '/precificacao', actionLabel: 'Definir preço', audience: ['commerce'], completionRule: 'pricing', permission: 'pricing.view', order: 4 }, { id: 'inventory', title: 'Configure seu estoque', shortDescription: 'Veja o que está disponível e o que precisa de reposição.', whyItMatters: 'O estoque real evita promessas de venda sem disponibilidade.', route: '/estoque', actionLabel: 'Abrir estoque', audience: ['commerce'], completionRule: 'inventory', permission: 'inventory.view', order: 5 }, { id: 'purchase', title: 'Registre uma compra ou reposição', shortDescription: 'Mantenha custos e estoque atualizados.', whyItMatters: 'Compras registradas preservam o histórico de reposição da empresa.', route: '/compras', actionLabel: 'Registrar compra', audience: ['commerce'], completionRule: 'purchase', permission: 'purchases.view', order: 6 }, { id: 'quote', title: 'Crie seu primeiro orçamento', shortDescription: 'Crie uma proposta comercial antes de confirmar a venda.', whyItMatters: 'Orçamento organiza a negociação sem movimentar estoque ou financeiro.', route: '/orcamentos', actionLabel: 'Criar orçamento', audience: ['commerce'], completionRule: 'quote', permission: 'quotes.view', order: 7 }, { id: 'sale', title: 'Registre sua primeira venda', shortDescription: 'Confirme uma operação real da empresa.', whyItMatters: 'A venda registrada alimenta os módulos relacionados conforme as regras do F7.', route: '/vendas', actionLabel: 'Registrar venda', audience: ['commerce'], completionRule: 'sale', permission: 'sales.view', order: 8 }, ...[
    { id: 'finance', title: 'Conheça seu Financeiro', shortDescription: 'Acompanhe o financeiro operacional da sua empresa.', whyItMatters: 'O módulo financeiro organiza títulos e compromissos do tenant.', route: '/financeiro', actionLabel: 'Abrir Financeiro', audience: ['commerce'], completionRule: 'seen', permission: 'finance.view', order: 9 },
    { id: 'intelligence', title: 'Conheça a F7 Intelligence', shortDescription: 'Receba análises baseadas em informações autorizadas da empresa.', whyItMatters: 'A IA recomenda; a pessoa responsável decide.', route: '/intelligence', actionLabel: 'Conhecer Intelligence', audience: ['commerce'], completionRule: 'seen', permission: 'intelligence.view', requiredFeature: 'intelligence', order: 10 },
  ]],
  services: [...common, { id: 'service', title: 'Cadastre seu primeiro serviço', shortDescription: 'Registre os atendimentos que sua empresa oferece.', whyItMatters: 'Serviços com preço definido podem seguir para orçamento e venda.', route: '/produtos', actionLabel: 'Cadastrar serviço', audience: ['services'], completionRule: 'service', permission: 'products.view', order: 3 }, { id: 'pricing', title: 'Defina o preço do serviço', shortDescription: 'Revise custo, preço de venda e margem.', whyItMatters: 'Preço claro ajuda a manter cada atendimento sustentável.', route: '/precificacao', actionLabel: 'Definir preço', audience: ['services'], completionRule: 'pricing', permission: 'pricing.view', order: 4 }, { id: 'quote', title: 'Crie seu primeiro orçamento', shortDescription: 'Apresente uma proposta antes de confirmar o atendimento.', whyItMatters: 'Orçamentos organizam a negociação sem antecipar a venda.', route: '/orcamentos', actionLabel: 'Criar orçamento', audience: ['services'], completionRule: 'quote', permission: 'quotes.view', order: 5 }, { id: 'sale', title: 'Registre sua primeira venda', shortDescription: 'Confirme um serviço realizado ou contratado.', whyItMatters: 'A venda registrada cria o histórico real da operação.', route: '/vendas', actionLabel: 'Registrar venda', audience: ['services'], completionRule: 'sale', permission: 'sales.view', order: 6 }, { id: 'finance', title: 'Conheça seu Financeiro', shortDescription: 'Acompanhe o financeiro operacional da sua empresa.', whyItMatters: 'O módulo financeiro organiza títulos do tenant, sem misturar com o billing F7.', route: '/financeiro', actionLabel: 'Abrir Financeiro', audience: ['services'], completionRule: 'seen', permission: 'finance.view', order: 7 }, { id: 'goals', title: 'Conheça Metas e Comissões', shortDescription: 'Acompanhe objetivos comerciais quando disponíveis.', whyItMatters: 'Metas ajudam a transformar atividade comercial em acompanhamento objetivo.', route: '/metas', actionLabel: 'Abrir Metas', audience: ['services'], completionRule: 'seen', permission: 'goals.view', order: 8 }, { id: 'intelligence', title: 'Conheça a F7 Intelligence', shortDescription: 'Receba análises baseadas em informações autorizadas da empresa.', whyItMatters: 'A IA recomenda; a pessoa responsável decide.', route: '/intelligence', actionLabel: 'Conhecer Intelligence', audience: ['services'], completionRule: 'seen', permission: 'intelligence.view', requiredFeature: 'intelligence', order: 9 }],
  production: [...common, { id: 'raw_material', title: 'Cadastre matérias-primas', shortDescription: 'Registre os insumos usados na produção.', whyItMatters: 'Matérias-primas ajudam a manter custo, estoque e composição rastreáveis.', route: '/produtos', actionLabel: 'Abrir Catálogo', audience: ['production'], completionRule: 'raw_material', permission: 'products.view', order: 3 }, { id: 'product', title: 'Cadastre seu primeiro produto', shortDescription: 'Registre o item produzido pela sua empresa.', whyItMatters: 'O produto conecta composição, custo, preço e estoque.', route: '/produtos', actionLabel: 'Cadastrar produto', audience: ['production'], completionRule: 'product', permission: 'products.view', order: 4 }, { id: 'pricing', title: 'Defina custo e preço', shortDescription: 'Revise o custo e o preço de venda do produto.', whyItMatters: 'A margem só pode ser analisada com valores reais.', route: '/precificacao', actionLabel: 'Definir preço', audience: ['production'], completionRule: 'pricing', permission: 'pricing.view', order: 5 }, { id: 'inventory', title: 'Configure seu estoque', shortDescription: 'Acompanhe insumos e produtos disponíveis.', whyItMatters: 'O estoque apoia reposição e evita falta de material.', route: '/estoque', actionLabel: 'Abrir estoque', audience: ['production'], completionRule: 'inventory', permission: 'inventory.view', order: 6 }, { id: 'production', title: 'Conheça Produção', shortDescription: 'Use o módulo de produção quando sua operação precisar.', whyItMatters: 'A produção organiza transformações de matéria-prima conforme os recursos disponíveis.', route: '/producao', actionLabel: 'Abrir Produção', audience: ['production'], completionRule: 'seen', permission: 'production.view', order: 7 }, { id: 'customer', title: 'Cadastre seu primeiro cliente', shortDescription: 'Registre quem compra seus produtos.', whyItMatters: 'O cliente é usado em orçamentos e vendas.', route: '/clientes', actionLabel: 'Cadastrar cliente', audience: ['production'], completionRule: 'customer', permission: 'customers.view', order: 8 }, { id: 'quote', title: 'Crie seu primeiro orçamento', shortDescription: 'Prepare a proposta comercial antes da venda.', whyItMatters: 'Orçamento organiza a negociação sem movimentar estoque ou financeiro.', route: '/orcamentos', actionLabel: 'Criar orçamento', audience: ['production'], completionRule: 'quote', permission: 'quotes.view', order: 9 }, { id: 'sale', title: 'Registre sua primeira venda', shortDescription: 'Confirme uma operação real.', whyItMatters: 'A venda registrada alimenta os módulos relacionados conforme as regras do F7.', route: '/vendas', actionLabel: 'Registrar venda', audience: ['production'], completionRule: 'sale', permission: 'sales.view', order: 10 }, { id: 'finance', title: 'Conheça seu Financeiro', shortDescription: 'Acompanhe o financeiro operacional da empresa.', whyItMatters: 'O financeiro do tenant não é o billing da plataforma F7.', route: '/financeiro', actionLabel: 'Abrir Financeiro', audience: ['production'], completionRule: 'seen', permission: 'finance.view', order: 11 }, { id: 'intelligence', title: 'Conheça a F7 Intelligence', shortDescription: 'Receba análises baseadas em informações autorizadas.', whyItMatters: 'A IA recomenda; a pessoa responsável decide.', route: '/intelligence', actionLabel: 'Conhecer Intelligence', audience: ['production'], completionRule: 'seen', permission: 'intelligence.view', requiredFeature: 'intelligence', order: 12 }],
});

export const ONBOARDING_JOURNEYS = Object.freeze(Object.values(JOURNEY_DEFINITIONS));
export const ONBOARDING_STEPS = definitions;
// Canonical content registry: future help articles and videos can consume the
// same metadata without duplicating educational copy in page components.
export const onboardingSteps = ONBOARDING_STEPS;
export const moduleGuides = Object.freeze(Object.fromEntries(Object.values(definitions).flat().map((step) => [step.id, step])));

export function getJourney(companyId) {
  if (!companyId || typeof localStorage === 'undefined') return null;
  const value = localStorage.getItem(`f7_onboarding_journey:${companyId}`);
  return definitions[value] ? value : null;
}

export function setJourney(companyId, journey) {
  if (!companyId || !definitions[journey] || typeof localStorage === 'undefined') return;
  localStorage.setItem(`f7_onboarding_journey:${companyId}`, journey);
}

export function isOnboardingDismissed(companyId) {
  return typeof localStorage !== 'undefined' && Boolean(companyId && localStorage.getItem(`f7_onboarding_dismissed:${companyId}`) === '1');
}

export function setOnboardingDismissed(companyId, dismissed = true) {
  if (!companyId || typeof localStorage === 'undefined') return;
  const key = `f7_onboarding_dismissed:${companyId}`;
  if (dismissed) localStorage.setItem(key, '1'); else localStorage.removeItem(key);
}

export function getSeenEducativeSteps(companyId) {
  if (!companyId || typeof localStorage === 'undefined') return {};
  try { return JSON.parse(localStorage.getItem(`f7_onboarding_seen:${companyId}`) || '{}') || {}; } catch { return {}; }
}

export function markEducativeStepSeen(companyId, stepId) {
  if (!companyId || !stepId || typeof localStorage === 'undefined') return;
  const seen = getSeenEducativeSteps(companyId); seen[stepId] = true;
  localStorage.setItem(`f7_onboarding_seen:${companyId}`, JSON.stringify(seen));
}

export function isNewCompany(company, snapshot = {}) {
  const operationalCount = ['customers', 'products', 'sales', 'quotes', 'purchases', 'movements'].reduce((sum, key) => sum + (Array.isArray(snapshot[key]) ? snapshot[key].length : 0), 0);
  return Boolean(company?.id && company.onboarding_completed !== true && operationalCount === 0);
}

export function visibleOnboardingSteps(journey, { canAccess = () => true, featureEnabled = () => true } = {}) {
  return (definitions[journey] || []).filter((step) => canAccess(step.permission)).map((step) => ({ ...step, journey, locked: Boolean(step.requiredFeature && !featureEnabled(step.requiredFeature)) })).filter((step) => !step.locked);
}

function belongs(row, company) { return row?.company_id == null || row.company_id === company?.id; }
function hasValidSale(row, company) { return belongs(row, company) && row && !['cancelled', 'canceled', 'void', 'failed'].includes(String(row.status || '').toLowerCase()); }
function hasPrice(row) { return Number(row?.sale_price ?? row?.price ?? 0) > 0; }

export function buildOnboardingProgress(steps, snapshot = {}, seen = {}) {
  const completed = {};
  for (const step of steps || []) {
    completed[step.id] = step.completionRule === 'company' ? Boolean(snapshot.company?.id)
      : step.completionRule === 'customer' ? (snapshot.customers || []).some((row) => row?.id && belongs(row, snapshot.company))
        : step.completionRule === 'product' ? (snapshot.products || []).some((row) => row?.id && belongs(row, snapshot.company) && (row?.item_type || 'product') === 'product')
          : step.completionRule === 'service' ? (snapshot.products || []).some((row) => row?.id && belongs(row, snapshot.company) && row?.item_type === 'service')
            : step.completionRule === 'raw_material' ? (snapshot.products || []).some((row) => row?.id && belongs(row, snapshot.company) && (row?.item_type === 'material' || row?.item_type === 'raw_material' || row?.item_type === 'raw-material' || row?.category === 'Matéria-prima'))
              : step.completionRule === 'pricing' ? (snapshot.products || []).some((row) => row?.id && belongs(row, snapshot.company) && hasPrice(row))
                : step.completionRule === 'inventory' ? (snapshot.movements || []).some((row) => row?.id && belongs(row, snapshot.company)) || (snapshot.products || []).some((row) => row?.id && belongs(row, snapshot.company) && row?.item_type !== 'service' && row?.stock !== null && row?.stock !== undefined)
                  : step.completionRule === 'purchase' ? (snapshot.purchases || []).some((row) => row?.id && belongs(row, snapshot.company))
                    : step.completionRule === 'quote' ? (snapshot.quotes || []).some((row) => row?.id && belongs(row, snapshot.company))
                      : step.completionRule === 'sale' ? (snapshot.sales || []).some((row) => hasValidSale(row, snapshot.company))
                        : Boolean(seen[step.id]);
  }
  const total = Object.keys(completed).length;
  const count = Object.values(completed).filter(Boolean).length;
  return { completed, total, count, percent: total ? Math.round((count / total) * 100) : 0, next: (steps || []).find((step) => !completed[step.id]) || null };
}

export function isOperationalCompany(snapshot = {}) {
  return ['customers', 'products', 'sales', 'quotes', 'movements'].some((key) => Array.isArray(snapshot[key]) && snapshot[key].length > 0);
}
