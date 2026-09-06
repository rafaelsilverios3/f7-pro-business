# Desacoplamento Base44/Supabase

Quando `VITE_DATA_PROVIDER=supabase`, as páginas dos fluxos principais usam repositories e services, e o plugin Vite do Base44 não é carregado. O fallback Base44 permanece disponível quando `VITE_DATA_PROVIDER=base44`.

## Migrado nesta etapa

- Dashboard: vendas, clientes, produtos, financeiro e movimentações usam repositories; metas e insights sem tabela Supabase ficam vazios com segurança.
- Estoque: produtos e movimentações usam provider/service, incluindo ajustes.
- Produtos: criação, edição e exclusão passam pelo `productsService`, com adaptação centralizada de `price`, `cost` e `minimum_stock`.
- Venda: leitura de clientes/produtos usa provider e finalização/cancelamento usam services.
- Onboarding: empresa, cliente, produto e primeira venda não fazem chamadas Base44 em Supabase.
- Notificações: contador vazio no Supabase até existir tabela própria.
- Usuários: membros são lidos de `company_users` e `profiles`; alterações usam RPCs com validação de role.
- Metas, relatórios e notificações: repositories/services Supabase com isolamento por empresa.

## Pendências

Ainda existem chamadas legadas em módulos P1/P2, principalmente diálogos de compras/orçamentos, páginas de atendimento, automações, relatórios, usuários e funções antigas em `src/lib`. Elas continuam necessárias para o fallback e serão migradas por módulo, após as tabelas Supabase correspondentes estarem disponíveis.

## Estratégia

Novas telas devem consumir repositories/services. Adapters no provider normalizam nomes de campos entre Base44 e Supabase; não espalhar condicionais de provider nos componentes. RLS e `company_id` continuam obrigatórios.
