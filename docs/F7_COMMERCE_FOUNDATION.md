# F7 Commerce — fundação (Etapa 1)

## Escopo desta etapa

F7 Commerce é uma central de navegação para capacidades comerciais já existentes no F7 PRO BUSINESS. A rota `/f7-commerce` usa o `Layout`, `CompanyGuard` e a permissão existente `sales_channels.view`. O painel não cria registros, chama integrações, altera estoque ou consulta tabelas adicionais.

Os cartões Mercado Livre e Shopee são apenas estado informativo: OAuth, anúncios, sincronização de catálogo/estoque/preço, pedidos externos e webhooks não estão implementados nesta etapa.

## Capacidades a reutilizar

- Catálogo e preços: `Product`, `productsRepository`, tela `/produtos` e `/precificacao`.
- Fornecedores e compras: `Supplier`, `PurchaseOrder`, repositórios e serviços atuais; telas `/compras` e `/supplier-intelligence`.
- Vendas e estoque: `Sale`, `StockMovement`, `salesService` e `inventoryService`.
- Oportunidades: `ProductOpportunity`, `Opportunity`, `opportunityFoundationService`, `MarketIntelligence` e `Opportunity Radar`.
- Canais: `SalesChannel`, `ProductChannel` e `ChannelMetric` já usados pelo Sales Hub (`salesHubService`). As relações existentes são por `company_id`; o cadastro de canal não implementa OAuth nem sincronização.
- Supabase e Base44: operações futuras devem manter o `providerSelector`/`repositoryFactory` quando forem compatíveis com ambos os providers, ou declarar claramente uma dependência Supabase no backend.

## Limites de segurança para integrações futuras

1. Não gravar access tokens, refresh tokens, client secrets ou chaves em `VITE_*`, no navegador, em logs ou em `SalesChannel.metadata`. O Sales Hub carrega os registros de canais para a interface; `metadata` não é um cofre de segredos.
2. Conduzir OAuth, troca/renovação de tokens, chamadas aos marketplaces e webhooks por funções backend autenticadas. O frontend recebe somente status e identificadores que pode exibir.
3. Vincular toda conexão a `company_id`, validar associação/permissão e proteger o estado OAuth contra CSRF/replay. Aplicar RLS ou privilégios de tabela que impeçam leitura direta de credenciais por `anon`/`authenticated`; escolher e validar cofre/criptografia antes de criar migrations.
4. Modelar sincronização com IDs externos e checkpoints por empresa/provedor, eventos de webhook idempotentes, retry controlado e trilha de auditoria. Não converter pedido externo em venda nem movimentar estoque/financeiro sem reconciliação e política explícita de idempotência.
5. Para fornecedores, reutilizar `Supplier` e o fluxo de compras. CSV/XML/API deve entrar primeiro em staging com origem, referência externa e validação; exigir revisão de correspondências antes de atualizar produtos, custos ou estoque.

## Dependências e validação antes da próxima etapa

- Confirmar o provider usado pelo deploy e a estratégia de migração no Supabase sem executar alterações de produção.
- Verificar suporte e requisitos atuais de OAuth, limites, webhooks e políticas de dados do Mercado Livre e da Shopee antes de implementar cada adapter.
- Definir armazenamento privado de credenciais, ciclo de revogação, isolamento multi-tenant, idempotência e tratamento de rate limits.
- Manter site institucional, login, redirects e domínio na mesma origem durante esta fundação.
