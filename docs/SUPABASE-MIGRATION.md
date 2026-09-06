# Migração para Supabase

O projeto agora possui provider dual. `VITE_DATA_PROVIDER=base44` mantém o comportamento atual; `VITE_DATA_PROVIDER=supabase` seleciona o provider PostgreSQL. Use somente `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY` no frontend. A chave `service_role` nunca deve ser exposta.

Fases recomendadas:

1. Aplicar `supabase/migrations/0001_initial_schema.sql` e `0002_critical_rpcs.sql` em um projeto Supabase de teste.
2. Validar clientes e produtos.
3. Validar vendas, estoque e financeiro, preferencialmente via RPC transacional.
4. Migrar compras, fornecedores e orçamentos.
5. Migrar comissões, usuários, notificações e demais módulos.

O fallback Base44 permanece ativo quando `VITE_DATA_PROVIDER` não é definido. A migração ainda não troca a autenticação nem os fluxos legados que usam o SDK diretamente.
