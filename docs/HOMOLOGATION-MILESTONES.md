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

