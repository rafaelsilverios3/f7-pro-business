/**
 * Canonical training/help content for the internal F7 modules.
 *
 * This registry is deliberately factual: it describes the workflows that
 * already exist in the application and never marks an operational step as
 * complete merely because somebody opened this guide.
 */
const script = (opening, context, prerequisites, steps, result, connections, next) => ({
  opening,
  context,
  prerequisites,
  steps,
  result,
  connections,
  next,
  // Editorial fields are deliberately separate from the student-facing guide.
  // They describe a future screen recording without claiming that a video exists.
  narration: opening,
  screenAction: steps,
  highlight: steps.map(() => null),
  note: steps.map(() => null),
});

const KEYWORDS = {
  dashboard: ['painel', 'indicadores', 'kpi', 'gráficos', 'alertas', 'resumo'],
  clientes: ['cliente', 'cadastro', 'pessoa', 'empresa', 'relacionamento', 'crm'],
  catalogo: ['catálogo', 'produto', 'serviço', 'matéria-prima', 'sku', 'código'],
  precificacao: ['preço', 'valor de venda', 'margem', 'markup', 'custo', 'centavos'],
  estoque: ['estoque', 'saldo', 'movimentação', 'entrada', 'saída', 'reposição'],
  compras: ['compras', 'fornecedor', 'recebimento', 'reposição', 'pedido'],
  orcamentos: ['orçamento', 'proposta', 'cotação', 'desconto', 'validade'],
  vendas: ['venda', 'registrar venda', 'pagamento', 'desconto', 'total'],
  pdv: ['pdv', 'caixa', 'venda rápida', 'balcão', 'pagamento'],
  producao: ['produção', 'ficha técnica', 'composição', 'matéria-prima', 'consumo'],
  financeiro: ['financeiro', 'caixa', 'receita', 'despesa', 'título', 'conta'],
  metas: ['metas', 'comissões', 'objetivo', 'vendedor', 'resultado'],
};

const guide = (data) => ({
  videoUrl: null,
  videoDuration: null,
  thumbnail: null,
  captionUrl: null,
  publishedAt: null,
  videoStatus: 'SCRIPT_READY',
  videoVersion: '1.0',
  lastReviewedAt: null,
  keywords: KEYWORDS[data.id] || [],
  audience: ['admin', 'gestor', 'financeiro', 'comercial', 'vendedor', 'estoque', 'atendimento'],
  estimatedMinutes: 4,
  ...data,
});

export const TRAINING_GUIDES = Object.freeze([
  guide({
    id: 'dashboard', module: 'Dashboard', title: 'Entenda seu Dashboard', shortDescription: 'Leia os indicadores reais da operação em um só lugar.',
    whyItMatters: 'O Dashboard resume registros operacionais para apoiar decisões rápidas; ele não é uma tela de cadastro.',
    whenToUse: 'Use no início do dia, em uma revisão de período ou antes de decidir sobre vendas, estoque e oportunidades.',
    beforeYouStart: 'Tenha clientes, produtos, vendas ou movimentos registrados para que os cartões e gráficos tenham evidência.',
    mainActions: ['Escolher o período', 'Atualizar os dados', 'Ler KPIs, gráficos, rankings e alertas', 'Abrir o módulo responsável pelo detalhe'],
    stepByStep: ['Selecione Hoje, 7 dias, 30 dias, mês ou outro período.', 'Confira faturamento, vendas, ticket e margem.', 'Leia alertas de estoque e oportunidades sem inferir causas que não aparecem nos dados.', 'Abra a origem para corrigir ou investigar o registro.'],
    whatHappensNext: 'A próxima ação recomendada leva ao módulo que possui o registro operacional.', connections: ['Vendas', 'Clientes', 'Estoque', 'Financeiro', 'Oportunidades'], commonMistakes: ['Confundir projeção com venda realizada', 'Ler o Dashboard como substituto do cadastro'], tips: ['Atualize após registrar uma operação', 'Use o período explicitamente ao comparar indicadores'], nextRecommendedModule: 'clientes', route: '/f7probusiness', requiredFeature: null,
    trainingScript: script('Veja o resumo da sua operação.', 'O painel reúne evidências dos módulos.', 'Registros operacionais reais.', ['Escolha o período', 'Leia os KPIs', 'Abra a origem'], 'Você entende o que aconteceu no período.', 'Cada cartão aponta para um módulo operacional.', 'Comece por Clientes ou Catálogo.'),
  }),
  guide({
    id: 'clientes', module: 'Clientes', title: 'Cadastre e acompanhe clientes', shortDescription: 'Mantenha pessoas e empresas organizadas para vender melhor.', whyItMatters: 'Clientes são a base de orçamentos, vendas e histórico de relacionamento.', whenToUse: 'Cadastre antes de criar um orçamento ou uma venda identificada.', beforeYouStart: 'Tenha nome/razão social e somente os dados necessários para o relacionamento.', mainActions: ['Cadastrar pessoa física ou jurídica', 'Pesquisar e editar', 'Abrir o histórico disponível'], stepByStep: ['Escolha o tipo de cliente.', 'Preencha os campos essenciais e revise os dados.', 'Salve e pesquise para confirmar o cadastro.', 'Use o cliente em orçamento, venda ou atendimento.'], whatHappensNext: 'O cliente fica disponível nos fluxos comerciais que aceitam identificação.', connections: ['Orçamentos', 'Vendas', 'PDV', 'CRM/Atendimento'], commonMistakes: ['Cadastrar duplicado', 'Coletar dados que não são necessários'], tips: ['Pesquise antes de criar', 'Mantenha telefone e documento atualizados'], nextRecommendedModule: 'catalogo', route: '/clientes', requiredFeature: null,
    trainingScript: script('Comece pela relação com seus clientes.', 'O cadastro identifica pessoas e empresas.', 'Dados mínimos e consentidos.', ['Escolha o tipo', 'Salve o cadastro', 'Use em uma venda ou orçamento'], 'O cliente aparece nos fluxos comerciais.', 'Orçamentos e vendas usam esse mesmo registro.', 'Conheça o Catálogo.'),
  }),
  guide({
    id: 'catalogo', module: 'Catálogo', title: 'Organize produtos, matérias-primas e serviços', shortDescription: 'Registre o que sua empresa vende e produz.', whyItMatters: 'O Catálogo conecta descrição, preço, estoque e operações sem misturar produto com serviço.', whenToUse: 'Configure itens antes de precificar, comprar, produzir ou vender.', beforeYouStart: 'Defina se o item é produto, matéria-prima ou serviço e se terá controle de estoque.', mainActions: ['Criar produto, matéria-prima ou serviço', 'Informar SKU, código de barras, unidade, custo e preço quando aplicável', 'Editar, inativar ou excluir conforme as regras reais'], stepByStep: ['Escolha o tipo de item.', 'Preencha nome, categoria e unidade.', 'Informe custo, preço e estoque somente onde se aplicam.', 'Salve e confira o card do item.'], whatHappensNext: 'O item pode ser usado nos módulos que suportam seu tipo.', connections: ['Precificação', 'Estoque', 'Compras', 'Orçamentos', 'Vendas', 'PDV', 'Produção'], commonMistakes: ['Cadastrar serviço como produto estocável', 'Alterar preço sem conferir margem', 'Criar duplicatas por não pesquisar'], tips: ['Use SKU consistente', 'Valores como 45,90 preservam os centavos'], nextRecommendedModule: 'precificacao', route: '/produtos', requiredFeature: null,
    trainingScript: script('O Catálogo é a fonte dos itens da operação.', 'Produto, matéria-prima e serviço têm comportamentos diferentes.', 'Definição do tipo e unidade.', ['Crie o item', 'Preencha dados', 'Confira preço e estoque'], 'O item fica pronto para os próximos módulos.', 'Preço e estoque dependem do tipo cadastrado.', 'Revise a Precificação.'),
  }),
  guide({
    id: 'precificacao', module: 'Precificação', title: 'Defina preço e margem', shortDescription: 'Compare custo, preço de venda e margem com valores reais.', whyItMatters: 'Preço e margem orientam decisões comerciais sem alterar registros por suposição.', whenToUse: 'Use ao lançar um item, revisar custos ou preparar uma venda.', beforeYouStart: 'Tenha custo real do produto ou serviço e defina o preço desejado.', mainActions: ['Consultar custo atual', 'Informar preço de venda', 'Calcular margem e cenários'], stepByStep: ['Abra o item.', 'Confira o custo.', 'Digite o preço determinado, por exemplo 45 ou 45,90.', 'Calcule e revise a margem antes de aplicar.'], whatHappensNext: 'Ao aplicar, o preço salvo alimenta Catálogo, Vendas e relatórios conforme o fluxo real.', connections: ['Catálogo', 'Compras', 'Vendas', 'Dashboard'], commonMistakes: ['Confundir markup com margem', 'Arredondar 45,90 para 45', 'Aplicar preço sem revisar custo'], tips: ['45 vira R$ 45,00; 45,90 permanece R$ 45,90', 'Confirme o valor após salvar'], nextRecommendedModule: 'estoque', route: '/precificacao', requiredFeature: null,
    trainingScript: script('Preço claro começa com custo conhecido.', 'A tela calcula margem a partir dos valores informados.', 'Custo e preço desejado.', ['Confira custo', 'Informe preço', 'Calcule margem', 'Aplique se estiver correto'], 'O preço aplicado permanece com seus centavos.', 'O Catálogo e as vendas usam o preço salvo.', 'Configure o Estoque.'),
  }),
  guide({
    id: 'estoque', module: 'Estoque', title: 'Acompanhe saldo e movimentações', shortDescription: 'Entenda o que entrou, saiu e precisa de reposição.', whyItMatters: 'Saldo e movimentos evitam vender ou produzir sem disponibilidade.', whenToUse: 'Use para conferir saldo, mínimo e a origem de cada alteração.', beforeYouStart: 'Cadastre itens estocáveis e registre compras, vendas ou produção reais.', mainActions: ['Consultar saldo atual', 'Ver entradas e saídas', 'Acompanhar estoque mínimo e alertas'], stepByStep: ['Filtre o item.', 'Compare saldo com estoque mínimo.', 'Abra a movimentação para identificar a origem.', 'Registre a operação no módulo correto.'], whatHappensNext: 'Compras, vendas e produção atualizam o estoque pelas regras oficiais.', connections: ['Catálogo', 'Compras', 'Vendas', 'PDV', 'Produção'], commonMistakes: ['Editar saldo para corrigir uma venda', 'Tratar serviço como estocável'], tips: ['Corrija pela origem da movimentação', 'Use o mínimo para planejar reposição'], nextRecommendedModule: 'compras', route: '/estoque', requiredFeature: null,
    trainingScript: script('Estoque é saldo com história.', 'Cada entrada e saída tem uma origem.', 'Itens estocáveis e operações reais.', ['Confira saldo', 'Leia movimentos', 'Aja no módulo de origem'], 'A disponibilidade fica rastreável.', 'Compras, vendas e produção geram movimentos.', 'Conheça Compras.'),
  }),
  guide({
    id: 'compras', module: 'Compras', title: 'Planeje compras e reposição', shortDescription: 'Conecte necessidade, fornecedor, recebimento e estoque.', whyItMatters: 'Compras registradas preservam custo e histórico de reposição.', whenToUse: 'Use quando o estoque sinalizar necessidade ou uma reposição for confirmada.', beforeYouStart: 'Tenha fornecedor e itens cadastrados, com quantidades e custos definidos.', mainActions: ['Cadastrar fornecedor', 'Montar compra', 'Acompanhar status e recebimento'], stepByStep: ['Identifique o item e a necessidade.', 'Selecione fornecedor e informe quantidade/custo.', 'Salve a compra.', 'Registre o recebimento quando a operação permitir.'], whatHappensNext: 'O recebimento pode atualizar estoque conforme o status oficial.', connections: ['Estoque', 'Catálogo', 'Financeiro'], commonMistakes: ['Confundir pedido com recebimento', 'Alterar estoque sem registrar a compra'], tips: ['Confira custo unitário e total', 'Mantenha o status atualizado'], nextRecommendedModule: 'orcamentos', route: '/compras', requiredFeature: null,
    trainingScript: script('Reposição começa com uma necessidade real.', 'A compra acompanha fornecedor e recebimento.', 'Fornecedor e item cadastrados.', ['Monte a compra', 'Salve', 'Receba quando aplicável'], 'A reposição fica auditável.', 'O estoque reage ao recebimento oficial.', 'Prepare um Orçamento.'),
  }),
  guide({
    id: 'orcamentos', module: 'Orçamentos', title: 'Prepare propostas comerciais', shortDescription: 'Monte uma proposta antes de confirmar a venda.', whyItMatters: 'Orçamento organiza negociação sem registrar receita, saída de estoque ou venda confirmada.', whenToUse: 'Use quando o cliente ainda precisa aprovar condições.', beforeYouStart: 'Tenha cliente e itens com preço revisado.', mainActions: ['Escolher cliente', 'Adicionar itens, quantidades e descontos/acréscimos', 'Definir validade e status', 'Converter somente após aprovação'], stepByStep: ['Selecione o cliente.', 'Adicione itens e revise valores.', 'Informe validade, observações e vendedor.', 'Salve e acompanhe o status.', 'Converta após aprovação, se o fluxo permitir.'], whatHappensNext: 'A conversão cria a venda oficial; o orçamento permanece no histórico.', connections: ['Clientes', 'Catálogo', 'Vendas', 'Financeiro'], commonMistakes: ['Tratar orçamento como venda', 'Aplicar desconto sem revisar total'], tips: ['Explique validade e condições', 'Revise o preço preservando centavos'], nextRecommendedModule: 'vendas', route: '/orcamentos', requiredFeature: null,
    trainingScript: script('Uma proposta aprovada ainda não é uma venda.', 'O orçamento organiza a negociação.', 'Cliente e itens precificados.', ['Monte itens', 'Revise valores', 'Salve', 'Converta após aprovação'], 'A venda só nasce na confirmação.', 'O histórico conecta orçamento e venda.', 'Registre uma Venda.'),
  }),
  guide({
    id: 'vendas', module: 'Vendas', title: 'Registre uma venda real', shortDescription: 'Confirme itens, valores, pagamento e efeitos operacionais.', whyItMatters: 'A venda oficial preserva o histórico e aciona efeitos autorizados em estoque e financeiro.', whenToUse: 'Use após confirmação do cliente ou conversão de orçamento.', beforeYouStart: 'Tenha cliente (quando aplicável), itens, preço e condição de pagamento revisados.', mainActions: ['Selecionar cliente e vendedor', 'Adicionar itens e quantidades', 'Informar desconto/acréscimo e pagamento', 'Confirmar e consultar o histórico'], stepByStep: ['Confira os itens e o preço determinado.', 'Informe desconto apenas se desejado.', 'Revise total e forma de pagamento.', 'Confirme uma única vez.', 'Confira venda, estoque e financeiro resultantes.'], whatHappensNext: 'Os registros oficiais aparecem nos módulos relacionados de acordo com o status.', connections: ['PDV', 'Estoque', 'Financeiro', 'Dashboard', 'Cliente 360'], commonMistakes: ['Usar desconto para compensar arredondamento', 'Confirmar sem revisar centavos', 'Confundir rascunho com venda'], tips: ['45 permanece 45,00 e 45,90 permanece 45,90', 'Investigue a origem se o saldo não mudar'], nextRecommendedModule: 'financeiro', route: '/vendas', requiredFeature: null,
    trainingScript: script('Venda confirmada é um registro oficial.', 'Ela deve respeitar preço, quantidade e pagamento.', 'Itens e cliente revisados.', ['Monte a venda', 'Revise total', 'Confirme', 'Audite os efeitos'], 'A operação fica disponível no histórico.', 'Estoque, financeiro e Dashboard leem a venda oficial.', 'Confira o Financeiro.'),
  }),
  guide({
    id: 'pdv', module: 'PDV', title: 'Venda com rapidez no PDV', shortDescription: 'Use o fluxo direto para operações rápidas.', whyItMatters: 'PDV agiliza a venda, mas continua usando a mesma operação oficial de vendas.', whenToUse: 'Use no balcão ou quando a prioridade for lançar e concluir rapidamente.', beforeYouStart: 'Tenha itens com preço e saldo compatíveis e forma de pagamento disponível.', mainActions: ['Pesquisar item', 'Informar quantidade', 'Identificar cliente quando aplicável', 'Receber e confirmar'], stepByStep: ['Pesquise o produto ou serviço.', 'Ajuste a quantidade.', 'Revise total e pagamento.', 'Confirme a venda.'], whatHappensNext: 'A operação aparece no histórico de Vendas e nos efeitos oficiais.', connections: ['Vendas', 'Estoque', 'Financeiro'], commonMistakes: ['Criar venda paralela fora do histórico', 'Ignorar saldo do item'], tips: ['Use para velocidade, não para pular revisão'], nextRecommendedModule: 'producao', route: '/pdv', requiredFeature: null,
    trainingScript: script('PDV é o caminho rápido para a mesma venda oficial.', 'Ele reduz passos, não muda as regras.', 'Itens e preços disponíveis.', ['Pesquise', 'Defina quantidade', 'Receba', 'Confirme'], 'A venda fica registrada como qualquer venda oficial.', 'O histórico é compartilhado com Vendas.', 'Se produzir, conheça Produção.'),
  }),
  guide({
    id: 'producao', module: 'Produção', title: 'Organize a produção', shortDescription: 'Use matéria-prima e ficha técnica somente no fluxo real.', whyItMatters: 'A produção rastreia consumo e produto final quando esses recursos estão disponíveis.', whenToUse: 'Use para fabricar itens com composição e consumo controlados.', beforeYouStart: 'Cadastre matérias-primas, produto final e composição compatível.', mainActions: ['Montar ficha técnica', 'Informar quantidade produzida', 'Registrar consumo', 'Conferir movimentos'], stepByStep: ['Escolha o produto fabricado.', 'Associe matérias-primas e quantidades.', 'Informe a produção.', 'Confirme e verifique entradas/saídas de estoque.'], whatHappensNext: 'Movimentos de consumo e produto final seguem as regras da produção.', connections: ['Catálogo', 'Estoque', 'Compras', 'Precificação'], commonMistakes: ['Produzir sem composição', 'Editar saldo em vez de registrar consumo'], tips: ['Valide unidade e quantidade antes de confirmar'], nextRecommendedModule: 'financeiro', route: '/producao', requiredFeature: null,
    trainingScript: script('Produção transforma insumos em produto final.', 'A ficha técnica explica o consumo.', 'Matérias-primas e produto cadastrados.', ['Monte composição', 'Informe produção', 'Confirme movimentos'], 'O consumo e o produto final ficam rastreáveis.', 'Estoque e custo dependem da composição real.', 'Confira o Financeiro.'),
  }),
  guide({
    id: 'financeiro', module: 'Financeiro', title: 'Acompanhe o financeiro operacional', shortDescription: 'Organize receitas, despesas e compromissos do seu tenant.', whyItMatters: 'O módulo mostra o financeiro da empresa cliente; ele não representa receita SaaS da F7 Business.', whenToUse: 'Use para registrar e acompanhar títulos e movimentações operacionais.', beforeYouStart: 'Defina categoria, valor, vencimento e status do lançamento.', mainActions: ['Registrar entrada ou saída', 'Acompanhar status', 'Filtrar e conciliar registros'], stepByStep: ['Escolha o tipo de lançamento.', 'Informe valor e categoria.', 'Salve e revise o status.', 'Use a origem da venda/compra quando disponível.'], whatHappensNext: 'Os registros alimentam o financeiro operacional e indicadores do tenant.', connections: ['Vendas', 'Compras', 'Dashboard', 'Relatórios'], commonMistakes: ['Confundir financeiro do tenant com billing da plataforma', 'Lançar valor sem origem'], tips: ['Mantenha status fiel ao recebimento', 'Não use este módulo para plano F7'], nextRecommendedModule: 'metas', route: '/financeiro', requiredFeature: null,
    trainingScript: script('Financeiro mostra os compromissos da sua empresa.', 'Não é o faturamento da plataforma F7.', 'Categoria e valor definidos.', ['Registre', 'Acompanhe status', 'Concilie com a origem'], 'O caixa operacional fica organizado.', 'Vendas e compras podem gerar lançamentos conforme regras reais.', 'Conheça Metas.'),
  }),
  guide({
    id: 'metas', module: 'Metas e Comissões', title: 'Acompanhe metas e comissões', shortDescription: 'Compare objetivos e resultados quando o recurso estiver disponível.', whyItMatters: 'Metas transformam atividade comercial em acompanhamento objetivo e transparente.', whenToUse: 'Use para definir período, responsável e indicador real.', beforeYouStart: 'Tenha permissão e dados de vendas compatíveis com a meta.', mainActions: ['Definir meta', 'Atribuir responsável', 'Escolher período', 'Comparar realizado'], stepByStep: ['Crie a meta com período e responsável.', 'Informe o alvo.', 'Acompanhe o realizado disponível.', 'Revise comissão somente conforme a regra configurada.'], whatHappensNext: 'A evolução passa a ser acompanhada no período definido.', connections: ['Vendas', 'Dashboard', 'Financeiro'], commonMistakes: ['Criar meta sem período', 'Confundir alvo com resultado realizado'], tips: ['Explique o indicador para a equipe', 'Use dados do período correto'], nextRecommendedModule: 'dashboard', route: '/metas', requiredFeature: null,
    trainingScript: script('Uma meta precisa de alvo e período.', 'O realizado vem dos dados disponíveis.', 'Responsável e indicador definidos.', ['Crie', 'Acompanhe', 'Compare'], 'A equipe sabe o que precisa alcançar.', 'Vendas e Dashboard fornecem evidência.', 'Volte ao Dashboard.'),
  }),
]);

const FUTURE_GUIDES = Object.freeze([
  { id: 'sales-hub', module: 'Sales Hub', route: '/sales-hub', requiredFeature: 'sales_channels.view' },
  { id: 'crm', module: 'CRM', route: '/atendimento', requiredFeature: 'conversation.view' },
  { id: 'marketing', module: 'Marketing', route: '/marketing', requiredFeature: 'reports.view' },
  { id: 'opportunity-radar', module: 'Opportunity Radar', route: '/opportunity-radar', requiredFeature: 'opportunity_radar.view' },
  { id: 'automacoes', module: 'Automações', route: '/automacoes', requiredFeature: 'automation.view' },
  { id: 'intelligence', module: 'F7 Intelligence', route: '/intelligence', requiredFeature: 'intelligence.view' },
  { id: 'supplier-intelligence', module: 'Supplier Intelligence', route: '/supplier-intelligence', requiredFeature: 'supplier_intelligence.view' },
  { id: 'relatorios', module: 'Relatórios', route: '/relatorios', requiredFeature: 'reports.view' },
]);

export const FUTURE_TRAINING_GUIDES = FUTURE_GUIDES;
export const trainingIds = Object.freeze(TRAINING_GUIDES.map(({ id }) => id));
export const helpContent = Object.freeze(Object.fromEntries(TRAINING_GUIDES.map((item) => [item.id, item])));

const byId = new Map([...TRAINING_GUIDES, ...FUTURE_GUIDES].map((item) => [item.id, item]));
const aliases = new Map([
  ['/f7probusiness', 'dashboard'], ['/dashboard', 'dashboard'], ['/clientes', 'clientes'], ['/produtos', 'catalogo'],
  ['/precificacao', 'precificacao'], ['/estoque', 'estoque'], ['/compras', 'compras'], ['/orcamentos', 'orcamentos'],
  ['/vendas', 'vendas'], ['/pdv', 'pdv'], ['/producao', 'producao'], ['/financeiro', 'financeiro'], ['/metas', 'metas'],
  ['customer', 'clientes'], ['product', 'catalogo'], ['service', 'catalogo'], ['raw_material', 'catalogo'], ['pricing', 'precificacao'], ['inventory', 'estoque'], ['purchase', 'compras'], ['quote', 'orcamentos'], ['sale', 'vendas'], ['finance', 'financeiro'], ['goals', 'metas'],
]);

const INTRO_VIDEO_SCRIPT = Object.freeze({
  opening: 'Olá! Neste treinamento do F7 Business, você vai conhecer o ambiente que conecta as principais áreas da sua empresa.',
  context: 'O F7 reúne clientes, produtos, preços, estoque, compras, orçamentos, vendas, financeiro, gestão e inteligência em um só lugar.',
  prerequisites: 'Use o tenant de demonstração aprovado para gravação e confirme que não há dados reais na tela.',
  steps: ['Apresente o Dashboard.', 'Mostre o menu lateral e a busca global.', 'Mostre notificações, plano atual e a entrada da Academia F7.', 'Explique como os módulos se conectam sem executar uma operação.'],
  result: 'A pessoa entende onde encontrar cada área antes de iniciar os treinamentos de módulo.',
  connections: 'Dashboard → Clientes → Catálogo → Operação → Gestão → Inteligência',
  next: 'Comece pelo Dashboard.',
  narration: 'Olá! Neste treinamento do F7 Business, você vai conhecer o ambiente que conecta as principais áreas da sua empresa.',
  screenAction: ['Apresente o Dashboard.', 'Mostre o menu lateral e a busca global.', 'Mostre notificações, plano atual e a entrada da Academia F7.', 'Explique como os módulos se conectam sem executar uma operação.'],
  highlight: [null, null, null, null],
  note: [null, null, null, null],
});

const videoRecord = (guideItem, sequence) => ({
  id: `video-${String(sequence).padStart(2, '0')}-${guideItem.id}`,
  sequence,
  moduleId: guideItem.id,
  title: guideItem.title,
  description: guideItem.shortDescription,
  objective: guideItem.whyItMatters,
  whereToFind: guideItem.route,
  content: guideItem.mainActions,
  learningObjectives: guideItem.mainActions,
  script: guideItem.trainingScript,
  route: guideItem.route,
  audience: guideItem.audience,
  journey: 'all',
  requiredFeature: guideItem.requiredFeature,
  videoUrl: null,
  thumbnailUrl: null,
  captionUrl: null,
  duration: null,
  publishedAt: null,
  version: guideItem.videoVersion,
  lastReviewedAt: guideItem.lastReviewedAt,
  status: guideItem.videoStatus,
  example: 'Use somente dados fictícios do tenant de demonstração aprovado para gravações.',
  whatHappensNext: guideItem.whatHappensNext,
  tips: guideItem.tips,
  relatedModules: guideItem.connections,
});

/**
 * Official recording order. This is an editorial catalog, not a list of
 * published assets: URLs and thumbnails stay null until real files exist.
 */
export const TRAINING_VIDEOS = Object.freeze([
  Object.freeze({
    id: 'video-01-conhecendo-f7',
    sequence: 1,
    moduleId: 'dashboard',
    title: 'Conhecendo o F7 Business',
    description: 'Visão geral do ambiente, menu, busca global, plano e Academia F7.',
    objective: 'Reconhecer o ambiente e localizar cada área sem executar uma operação durante a apresentação.',
    whereToFind: '/f7probusiness',
    content: ['Dashboard', 'Menu lateral', 'Busca global', 'Notificações', 'Plano atual', 'Academia F7'],
    learningObjectives: ['Reconhecer o Dashboard', 'Localizar o menu e a busca global', 'Entender a conexão entre os módulos'],
    script: INTRO_VIDEO_SCRIPT,
    route: '/f7probusiness',
    audience: ['admin', 'gestor'],
    journey: 'all',
    requiredFeature: null,
    videoUrl: null,
    thumbnailUrl: null,
    captionUrl: null,
    duration: null,
    publishedAt: null,
    version: '1.0',
    lastReviewedAt: null,
    status: 'SCRIPT_READY',
    example: 'Use o tenant de demonstração aprovado, sem clientes ou credenciais reais.',
    whatHappensNext: 'Comece pelo treinamento do Dashboard e siga a trilha adequada ao seu negócio.',
    tips: ['Mantenha o cursor visível', 'Não mostre console, credenciais ou notificações reais'],
    relatedModules: ['Dashboard', 'Clientes', 'Catálogo', 'Estoque', 'Compras', 'Orçamentos', 'Vendas', 'Financeiro', 'Metas e Comissões', 'F7 Intelligence'],
  }),
  ...TRAINING_GUIDES.map((guideItem, index) => Object.freeze(videoRecord(guideItem, index + 2))),
]);

export const trainingVideos = TRAINING_VIDEOS;

export function getTrainingVideosForModule(moduleId) {
  return TRAINING_VIDEOS.filter((video) => video.moduleId === moduleId);
}

export function getTrainingVideo(moduleId) {
  const videos = getTrainingVideosForModule(moduleId);
  return videos.find((video) => video.videoUrl) || videos.find((video) => video.sequence > 1) || videos[0] || null;
}

export function validateTrainingVideoCatalog(videos = TRAINING_VIDEOS) {
  const errors = [];
  const idsSeen = new Set();
  const sequencesSeen = new Set();
  const validModules = new Set([...TRAINING_GUIDES, ...FUTURE_GUIDES].map(({ id }) => id));
  const placeholderUrl = /^(#|.*(coming[-_ ]?soon|placeholder|example\.com|youtube\.com\/watch\?v=VIDEO))/i;

  for (const video of videos) {
    if (!video?.id || idsSeen.has(video.id)) errors.push(`duplicate or missing video id: ${video?.id || 'unknown'}`);
    idsSeen.add(video?.id);
    if (sequencesSeen.has(video.sequence)) errors.push(`duplicate video sequence: ${video.sequence}`);
    sequencesSeen.add(video.sequence);
    if (!validModules.has(video.moduleId)) errors.push(`${video.id} references an unknown module`);
    const guideItem = byId.get(video.moduleId);
    if (video.sequence > 1 && guideItem?.route !== video.route) errors.push(`${video.id} route does not match its module`);
    if (!video.script?.narration || !Array.isArray(video.script?.screenAction)) errors.push(`${video.id} has no recording script`);
    if (video.videoUrl && placeholderUrl.test(video.videoUrl)) errors.push(`${video.id} has a placeholder video URL`);
    if (video.thumbnailUrl && placeholderUrl.test(video.thumbnailUrl)) errors.push(`${video.id} has a placeholder thumbnail URL`);
    if (video.status === 'PUBLISHED' && !video.videoUrl) errors.push(`${video.id} is published without a video URL`);
    if (!video.videoUrl && video.status === 'PUBLISHED') errors.push(`${video.id} cannot be published without a real asset`);
  }
  return { valid: errors.length === 0, errors };
}

export function getTrainingGuide(idOrRoute) {
  const id = aliases.get(idOrRoute) || idOrRoute;
  return byId.get(id) || null;
}

export function getTrainingForJourney(journey = 'commerce') {
  const order = journey === 'services'
    ? ['dashboard', 'clientes', 'catalogo', 'precificacao', 'orcamentos', 'vendas', 'financeiro', 'metas']
    : journey === 'production'
      ? ['dashboard', 'catalogo', 'precificacao', 'estoque', 'compras', 'producao', 'clientes', 'orcamentos', 'vendas', 'financeiro']
      : ['dashboard', 'clientes', 'catalogo', 'precificacao', 'estoque', 'compras', 'orcamentos', 'vendas', 'pdv', 'financeiro', 'metas'];
  return order.map((id) => getTrainingGuide(id)).filter(Boolean);
}

export function getNextTrainingGuide(idOrRoute, journey = 'commerce') {
  const guides = getTrainingForJourney(journey);
  const index = guides.findIndex((item) => item.id === (aliases.get(idOrRoute) || idOrRoute));
  return index >= 0 ? guides[index + 1] || null : guides[0] || null;
}

export function searchTrainingGuides(query, guides = TRAINING_GUIDES) {
  const normalized = String(query || '').trim().toLocaleLowerCase('pt-BR');
  if (!normalized) return guides;
  return guides.map((item) => {
    const haystack = [item.title, item.module, item.shortDescription, item.whyItMatters, ...(item.keywords || []), ...(item.stepByStep || []), ...(item.commonMistakes || [])].join(' ').toLocaleLowerCase('pt-BR');
    const tokens = normalized.split(/\s+/).filter(Boolean);
    const score = tokens.reduce((total, token) => total + (haystack.includes(token) ? ((item.keywords || []).some((keyword) => keyword.includes(token)) ? 3 : 1) : 0), 0);
    return { item, score };
  }).filter(({ score }) => score > 0).sort((a, b) => b.score - a.score || String(a.item.title || a.item.module || '').localeCompare(String(b.item.title || b.item.module || ''), 'pt-BR')).map(({ item }) => item);
}

function seenKey(companyId, userId) {
  return companyId && userId ? `f7_training_seen:${companyId}:${userId}` : null;
}

export function getSeenTrainingGuides(companyId, userId) {
  if (typeof localStorage === 'undefined') return {};
  const key = seenKey(companyId, userId);
  if (!key) return {};
  try { return JSON.parse(localStorage.getItem(key) || '{}') || {}; } catch { return {}; }
}

export function markTrainingGuideSeen(companyId, userId, guideId) {
  if (typeof localStorage === 'undefined' || !guideId) return;
  const key = seenKey(companyId, userId);
  if (!key) return;
  const seen = getSeenTrainingGuides(companyId, userId);
  seen[guideId] = { seenAt: new Date().toISOString() };
  localStorage.setItem(key, JSON.stringify(seen));
}
