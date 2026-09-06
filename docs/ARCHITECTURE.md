# Arquitetura

As páginas e componentes cuidam da apresentação. `src/contexts` centraliza autenticação e empresa ativa. `src/data/providers` é o ponto único de integração com o Base44; repositories em `src/data/repositories` aplicam `company_id` em listagens, criações, atualizações e exclusões. Serviços em `src/services` e `src/lib` concentram regras de venda, estoque, financeiro, compras e orçamentos.

Autenticação segue o mesmo contrato em `src/auth`: o selector usa Supabase Auth quando `VITE_DATA_PROVIDER=supabase` e mantém o adaptador Base44 como fallback. O onboarding cria a primeira empresa pelo RPC `create_company_with_owner`, que usa `auth.uid()` e associa o usuário como administrador dentro de uma transação. O `CompanyContext` só seleciona empresas retornadas pela associação do usuário.

O provider atual ainda usa o SDK Base44. Repositories não permitem trocar `company_id` em atualizações e rejeitam operações sem empresa. A camada de cálculos é pura e possui typecheck estrito e testes.
