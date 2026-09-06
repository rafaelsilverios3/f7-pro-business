# Arquitetura

As páginas e componentes cuidam da apresentação. `src/contexts` centraliza autenticação e empresa ativa. `src/data/providers` é o ponto único de integração com o Base44; repositories em `src/data/repositories` aplicam `company_id` em listagens, criações, atualizações e exclusões. Serviços em `src/services` e `src/lib` concentram regras de venda, estoque, financeiro, compras e orçamentos.

Autenticação segue o mesmo contrato em `src/auth`: o selector usa Supabase Auth quando `VITE_DATA_PROVIDER=supabase` e mantém o adaptador Base44 como fallback. O onboarding cria a primeira empresa pelo RPC `create_company_with_owner`, que usa `auth.uid()` e associa o usuário como administrador dentro de uma transação. O `CompanyContext` só seleciona empresas retornadas pela associação do usuário.

O RPC `finalize_sale` também calcula e grava a comissão na mesma transação da venda quando há vendedor e taxa configurada no produto ou item. `cancel_sale` marca a comissão como `reversed` sem repetir a reversão.

Os módulos de gestão usam `profiles`, `goals` e `notifications`. Operações de membros passam por RPCs `SECURITY DEFINER` que validam associação e role; o frontend nunca consulta `auth.users` diretamente.

O provider atual ainda usa o SDK Base44. Repositories não permitem trocar `company_id` em atualizações e rejeitam operações sem empresa. A camada de cálculos é pura e possui typecheck estrito e testes.

## Etapa 11 — módulos inteligentes

A migration `0010_smart_modules.sql` adiciona conversas, mensagens, oportunidades, automações, execuções idempotentes e insights. Todas as tabelas têm `company_id`, RLS e grants para o Data API.

`conversationsService`, `opportunitiesService`, `automationService` e `intelligenceService` isolam os fluxos das páginas. A automação suporta ações determinísticas de notificação e usa `idempotency_key` em `automation_runs`. O Intelligence atual gera apenas alertas determinísticos de estoque, clientes inativos e contas vencidas; não há IA generativa ou WhatsApp nesta etapa.
