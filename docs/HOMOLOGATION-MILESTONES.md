# Marcos de homologação do F7 Business

## 2026-10-12 — F7 Supplier Offers

**Resultado informado:** GO para o escopo funcional e de segurança efetivamente testado em homologação.

**Ambiente:** Preview da branch `codex/harden-multi-tenant-isolation`; Supabase de homologação `f7-pro-business-homolog` (`vwylnjmapixtzhryiutt`). Produção não faz parte deste marco.

**Evidências registradas no encerramento da homologação:**

- Isolamento entre Empresas Homolog A e B nas verificações executadas.
- Operações não autorizadas do papel Vendedor foram bloqueadas.
- A fixture fictícia permaneceu íntegra após as tentativas controladas.
- O estoque próprio permaneceu preservado.
- A interface da aba Ofertas recuperou o carregamento após o erro controlado.
- O harness de homologação utilizado está em `src/pages/homologation/suites/SupplierOffersSuite.jsx` e `src/pages/homologation/suites/supplierOffersChecks.js`; os testes estruturais estão em `tests/homologation-rest-runner.test.mjs` e as verificações de fundação em `tests/supplier-offers.test.mjs`.

**Limite de evidência preservado:** o encerramento fornecido ao repositório não incluiu exportação dos resultados REST, códigos HTTP por operação, identificadores da fixture ou capturas da execução. Portanto, este registro preserva o resultado e os itens confirmados pelo responsável pela homologação, mas não inventa códigos, contagens ou artefatos brutos. Esta anotação não amplia o GO para recursos ou operações que não foram testados.

**Fora do escopo:** produção, publicações em marketplaces, integrações externas, dados reais de clientes/fornecedores e validações de módulos não abrangidas pelas provas acima.

## 2026-10-12 — Supplier Offers + F7 Pricing: fechamento da rodada de leitura

**Ambiente observado:** Preview `f7-pro-business-g217u4mxa-rafaelsilverios3-6843s-projects.vercel.app`, com o guard visível indicando `f7-pro-business-homolog` / `vwylnjmapixtzhryiutt` e Preview da branch `codex/harden-multi-tenant-isolation`. Nenhuma consulta foi feita a Production nesta rodada.

**Resultados registrados:**

- **PASS — Supplier Offers, Admin B / Empresa B, REST HEAD filtrado pela Empresa A:** HTTP 200 e zero linhas visíveis. A tela do executor identificou `Admin B / B`; o resultado foi `linhas visíveis=0`. Isso comprova somente a contagem HEAD sob essa sessão e filtro.
- **PASS informado anteriormente — F7 Pricing + Supplier Offers:** o responsável pela homologação reportou GO para o escopo funcional testado no Preview. Este marco preserva esse escopo informado e não o expande para cenários que não tenham evidência específica registrada.
- **BLOCKED — Interface B:** a captura fornecida mostra `Empresa Homolog B`, papel Administrador e o aviso de fim do teste gratuito/plano. O acesso às telas funcionais de Pricing/Ofertas ficou atrás do paywall; não houve tentativa de contorná-lo nem alteração de plano.
- **Não testado:** troca de empresa e proteção contra dados residuais/transitórios durante troca de contexto.
- **BLOCKED — Supplier Offers, Admin B, REST GET filtrado pela Empresa A:** não executado. O executor existente usa consulta HEAD com `count: 'exact'`; não oferece GET de linhas para esse cenário. A execução no navegador também não disponibilizou uma via autorizada para emitir uma consulta REST adicional com a sessão real.
- **BLOCKED — Supplier Offers, Admin B, REST GET por IDs de ofertas da Empresa A:** não executado. O executor não expõe os IDs fictícios por uma leitura proprietária e não tem teste GET por ID. Não foi usada consulta administrativa nem extraída sessão/JWT do navegador como substituto.

**Limite da conclusão:** o resultado HEAD 200/zero não prova, por si só, o comportamento de GET que devolve linhas ou GET por identificador. A leitura cruzada REST solicitada permanece incompleta. Não afirmar isolamento GET completo, proteção da interface B, troca de empresa ou prevenção de dados residuais com base neste marco.

**Avaliação das ferramentas locais:** `tests/homologation-rest-runner.test.mjs` verifica estruturalmente a proteção Preview/projeto, a identificação da sessão e que o código executa HEAD; não é um teste de integração REST autenticado. `runSupplierOffersReadChecks` implementa HEAD cross-tenant para Admin B e não implementa GET de linhas nem GET por ID. Portanto, fixtures e testes automatizados atuais não fecham a lacuna de GET.

**Abordagem futura proposta (não executada):** após aprovação específica, usar um runner local de integração com uma conta Auth fictícia dedicada à Empresa B e a mesma Data API de homologação. O runner autenticaria essa conta pelo fluxo oficial do Supabase Auth (`signInWithPassword`, com segredo lido de armazenamento seguro local ou entrada interativa, nunca de argumento/arquivo/log), verificaria identidade e membership ativo por `auth.getUser()` e consulta autorizada a `company_users`, e então faria somente GETs PostgREST: (1) filtro `company_id = Empresa A`, e (2) `id IN (...)` com IDs de ofertas fictícias previamente obtidos pela sessão proprietária A. Registrar apenas destino, identidade/papel/empresa confirmados, status HTTP, contagem e resultado; manter JWT apenas em memória e sem service role. Uma resposta 200 com lista vazia é distinta de 401/403, erro de rede/schema ou falha de precondição. Criar conta, guardar credenciais, obter IDs via sessão A e executar o runner exigem autorização e preparação próprias; nenhuma dessas ações foi feita nesta rodada.

## 2026-10-12 — F7 AI Sales Assistant: homologação complementar de segurança

**Alvo conferido:** branch `codex/harden-multi-tenant-isolation`, commit `4fe7c6c3a28c5244911c5dcc7217da1b7d7b35d9`; o checkout estava limpo no início da rodada. Vercel Preview READY: `https://f7-pro-business-1xn1ei9an-rafaelsilverios3-6843s-projects.vercel.app`, alias da branch `https://f7-pro-business-git-code-e22f7d-rafaelsilverios3-6843s-projects.vercel.app`. O guard visível do Preview confirmou o projeto Supabase `f7-pro-business-homolog` / `vwylnjmapixtzhryiutt`. A Edge Function `ai-sales-assistant` estava ACTIVE na versão 13, `verify_jwt=true`. Produção não foi consultada.

**PASS real no Preview — Admin A / Empresa Homolog A:** sessão autenticada identificada como Administrador, plano PRO. A UI do AI Sales mostrou `Modo factual · sem geração por IA` e respostas de leitura para a fixture fictícia `HOMOLOG-A-QA-20261011`. A resposta distinguiu oferta BRL elegível de ofertas draft, vencida, suspensa e USD, e informou a quantidade declarada pelo fornecedor. Na consulta de 26 unidades, a declaração de 25 foi reportada como insuficiente, sem margem ou investimento para o pedido. Na consulta de 20 unidades, a simulação parcial identificou MOQ e custos ausentes como estimativas/limitações. Nenhuma consulta solicitou operação persistente.

**PASS real no Preview — isolamento REST pontual, Admin B / Empresa Homolog B:** a sessão Auth real foi identificada como Administrador B. A leitura REST HEAD cross-tenant de `supplier_offers`, filtrada para ofertas da Empresa A, retornou HTTP 200 e zero linhas visíveis. A tela do AI Sales para B exibiu `Seu teste gratuito terminou`; não foi enviada consulta à função nem contornado o entitlement. Portanto, o PASS é somente para aquela leitura REST HEAD, não prova isolamento de saída do AI Sales para B.

**PASS automatizado:** em 2026-10-12 foram executados sete arquivos de teste direcionados (`ai-sales.test.mjs`, `ai-sales-assistant-backend.test.mjs`, `ai-sales-access.test.mjs`, `assistant-backend-permissions.test.mjs`, `ai-observability.test.mjs`, `company-feature-overrides.test.mjs`, `homologation-rest-runner.test.mjs`): 51 aprovados, 0 falhas. Cobrem, entre outros, autorização por ferramenta, tenant scoping, privacidade/minimização do contexto, elegibilidade e quantidades de Supplier Offers, fallback factual, confirmação humana, reserva de orçamento e ausência de sondagem paga. São testes automatizados locais, não substituem chamadas autenticadas de todos os papéis.

**BLOCKED / pendente:**

- **Admin B no AI Sales:** bloqueado pelo trial encerrado. Não houve chamada ao assistente para B, nem alteração de plano ou tentativa de contornar o paywall.
- **Vendedor A:** nenhuma sessão autenticada disponível; não foram comprovadas em runtime as ferramentas permitidas nem as negações por papel.
- **Alternância A/B e resíduos de contexto:** não testados com sessões alternadas no AI Sales.
- **Limites ao vivo:** não houve esgotamento de rate limit/orçamento nem chamada paga. A cobertura é automatizada; o bloqueio real no provedor/orçamento não foi exercitado.
- **Erro ao vivo/sanitização:** não foi induzido erro de backend nesta rodada. A proteção é coberta parcialmente pelo código/testes, não por fault injection autenticado.
- **Estado comercial:** as chamadas da rodada foram somente leitura. O snapshot anterior da fixture de A registrou preço R$ 10,50, custo R$ 5,00, estoque próprio 10 e seis ofertas sem diferenças antes/depois. Isso não é auditoria integral das tabelas de pedidos, compras e financeiro.

**Conclusão limitada:** nenhum FAIL novo foi observado. Status da homologação integral do AI Sales: **BLOCKED**, não GO. Os PASS acima preservam precisamente os cenários observados; não generalizam para outros papéis, empresas ou operações.

## Plano de ativação gradual de IA generativa — somente leitura, ainda não autorizado

### Arquitetura observada

- A Edge Function `ai-sales-assistant` autentica o JWT (`auth.getUser`), confirma membership ativo e papel, consulta o entitlement server-side `company_has_feature_internal('ai_sales')` e valida a permissão específica da ferramenta antes da consulta comercial. Consultas usam cliente vinculado ao JWT e filtro de empresa; a função privilegiada é usada no servidor para controles internos/auditoria.
- `AI_ENABLED`, `AI_API_KEY` e opcionalmente `AI_API_URL` são lidos somente no servidor. A configuração exige opt-in literal `true`, chave e URL HTTPS sem credenciais, query ou fragmento. A existência dos valores não prova conectividade; a tela atual permanece factual e não foi feita chamada ao provedor.
- O caminho generativo usa o `ModelRouter` existente com um adaptador OpenAI-compatible, endpoint padrão Chat Completions, se nenhum endpoint for configurado. O modelo tem fallback de código para `gpt-4o-mini`. O modelo só recebe projeção reduzida dos dados e a resposta factual para paráfrase; dados pessoais, IDs comerciais e URLs privadas são excluídos da projeção.
- Rate limit observado: chat até 10 chamadas por usuário/empresa por 60 segundos; verificação de status até 30 por usuário/empresa por 60 segundos. O status não testa a conexão do provedor.
- O orçamento existente (`reserve_ai_budget`) reserva chamadas, tokens e custo por empresa/dia, com lock transacional. A função retorna resposta factual quando provedor/configuração/orçamento não permitem geração. A auditoria grava traces/eventos, estágios, contagens, códigos seguros e estimativas; ela não grava o texto da resposta do provedor nos campos de `ai_runs`/`ai_run_events`.
- Escrita comercial permanece separada: criar rascunho exige confirmação humana e RPC existente. Não é necessária para a ativação de respostas analíticas e não deve ser incluída no canário generativo.

### Bloqueios técnicos a resolver antes de qualquer chamada paga

1. A migration `0046_ai_observability_cost_health.sql` define `max_daily_ai_cost` e `estimated_cost_per_1k_tokens` com default `0`; na RPC, limite diário de custo só é aplicado quando `max_daily_ai_cost > 0`. Assim, valor zero **não é um teto financeiro**.
2. A reserva atual estima tokens de entrada por `ceil(payload.length / 4)` e custo pela taxa interna por 1.000 tokens, mas não reserva um teto de tokens de saída, não define limite explícito de saída na requisição ao modelo e não reconcilia a cobrança/uso real devolvido pelo provedor. O limite de 2.400/400 caracteres é aplicado à resposta já recebida e não limita o custo gerado antes disso.
3. Não foi confirmado por leitura nesta rodada se as configurações de orçamento da Empresa A estão preenchidas com limites não-zero e preços atuais do modelo. O teste de status apenas requer chamadas/dia > 0 e tokens/request >= 256; não prova orçamento monetário suficiente.

Por esses motivos, **não há atualmente evidência suficiente para GO de ativação paga**. Antes, uma alteração local revisável deve estabelecer teto de saída, reservar custo máximo de entrada+saída antes da chamada, rejeitar orçamento ausente/zero, e reconciliar uso/custo real ou aplicar limite superior conservador. A ativação segue bloqueada até essa revisão e autorização própria; esta anotação não altera o código nem as configurações.

### Proposta de rollout e critérios GO/NO-GO

1. **Pré-requisitos (GO obrigatório):** aprovação explícita do provedor/modelo e do tratamento/retensão de dados; preço atual de input e output conferido na fonte do provedor; limites por empresa não-zero; teto de tokens de entrada e saída imposto antes da chamada; custo máximo diário > 0 com teste de negação; chave apenas como secret da Edge Function da homologação; entitlement já existente, sem alteração de plano; CI e testes de papéis/isolation atualizados. Se algum requisito faltar, NO-GO e modo factual permanece.
2. **Canário exclusivamente homolog:** uma única empresa e administrador autorizado, no máximo 1 chamada generativa inicialmente; uma ferramenta de leitura de baixo risco; sem rascunho, fornecedor externo, PII ou escrita. Conferir trace e uso no painel do provedor; comparar com o limite reservado. Interromper se o custo/uso real exceder o reservado, aparecer campo privado, houver tenant mismatch, resposta inventada ou erro não sanitizado.
3. **Amostra limitada:** após canário aprovado, limite sugerido para avaliação de até 5 chamadas/dia, entrada até 1.000 tokens e saída até 300 tokens por chamada (teto desejado de 6.500 tokens/dia e 195.000 em 30 dias, por empresa). Estes números são apenas cenário de planejamento e **não são limites já configurados nem atualmente garantidos**. O custo em moeda só pode ser estimado após selecionar modelo e conferir preços atuais: `chamadas × (tokens_in × preço_in + tokens_out × preço_out)`, com ambos os preços na mesma unidade; o teto diário monetário deve ser menor ou igual ao valor aprovado pelo responsável.
4. **Monitoramento e stop:** observar rate limit, reservas e recusa de orçamento; comparar `ai_runs`/`ai_run_events` sanitizados com métricas do provedor; alertar antes do teto e cortar novas chamadas ao atingir o limite. O kill switch imediato é manter `AI_ENABLED=false` (e, se necessário, remover a chave do secret de homologação); confirmar depois que status/respostas ficam em `factual_only`. Também parar em qualquer FAIL de autorização, privacidade, isolamento, orçamento, custo divergente ou erro com dados internos.
5. **Rampa:** só ampliar para mais papéis/empresas após evidência autenticada de Admin A, Admin B e Vendedor A (incluindo negações), troca de contexto sem resíduo, bloqueio de orçamento/rate limit e ausência de efeitos comerciais. Nenhum passo implica autorização para Production.

**Riscos residuais:** custos de saída não limitados/reservados na implementação atual; custo real do modelo não reconciliado; sessões de vendedor e Admin B para AI Sales ausentes/bloqueadas nesta rodada; sem teste ao vivo de negação por papel, troca de empresa, rate limit esgotado, orçamento esgotado ou falha de provedor. Esta proposta não ativa serviço, não estima preço atual e não autoriza chamadas pagas.

