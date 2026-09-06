# Migração para Supabase

O projeto agora possui provider dual. `VITE_DATA_PROVIDER=base44` mantém o comportamento atual; `VITE_DATA_PROVIDER=supabase` seleciona o provider PostgreSQL. Use somente `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY` no frontend. A chave `service_role` nunca deve ser exposta.

Fases recomendadas:

1. Aplicar `supabase/migrations/0001_initial_schema.sql` e `0002_critical_rpcs.sql` em um projeto Supabase de teste.
2. Validar clientes e produtos.
3. Validar vendas, estoque e financeiro, preferencialmente via RPC transacional.
4. Migrar compras, fornecedores e orçamentos.
5. Migrar comissões, usuários, notificações e demais módulos.

## Conexão de um projeto real

1. Crie um projeto em supabase.com e configure o Supabase Auth.
2. Execute as migrations na ordem (`0001` a `0004`) pelo SQL Editor ou `supabase db push`.
3. Execute `supabase/seed.sql` apenas em ambiente de desenvolvimento.
4. Crie a conta pela tela de cadastro da aplicação e confirme o e-mail, se essa opção estiver habilitada.
5. No onboarding, informe o nome da empresa; a RPC `create_company_with_owner` cria a empresa e associa o usuário autenticado como `admin`.
6. Configure `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` e `VITE_DATA_PROVIDER=supabase` no ambiente do frontend.
7. Teste cliente, produto, venda, estoque e financeiro. As RPCs transacionais exigem usuário autenticado e associação em `company_users`.

O fallback Base44 permanece ativo quando `VITE_DATA_PROVIDER` não é definido. A migração ainda não troca a autenticação nem os fluxos legados que usam o SDK diretamente.
Migration 0006 adiciona `companies.onboarding_completed` e garante os grants de leitura/atualização para `authenticated`. Empresas de teste criadas durante o diagnóstico são mantidas; nenhuma rotina de limpeza automática deve ser executada.

Migration 0007 adiciona os campos usados pela configuração da empresa e grants dos módulos P1. Migration 0008 torna a comissão parte da transação `finalize_sale` e reverte com `cancel_sale`. O CLI Supabase não está instalado neste checkout; a aplicação remota dessas migrations deve ser feita pelo Supabase Dashboard/CLI autenticado.

Migration 0009 cria `profiles`, `goals` e `notifications`, além das RPCs de gerenciamento de membros. Ela também cria perfis automaticamente para novos usuários Auth. Aplicar a migration em ambiente remoto com credenciais administrativas do projeto.

## Migração incremental — etapa 11

Aplicar `supabase/migrations/0010_smart_modules.sql` no projeto Supabase real antes de habilitar os módulos. A migration cria tabelas com isolamento por `company_id` e políticas RLS. O frontend não usa `service_role`.

A automação atual executa somente ações internas determinísticas e registra sucesso/erro; integrações externas e IA ficam para uma etapa posterior. Antes da produção, revisar políticas de role no backend e configurar observabilidade para `automation_runs` e `intelligence_insights`.
