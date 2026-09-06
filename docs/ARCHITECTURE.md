# Arquitetura

As páginas e componentes cuidam da apresentação. `src/contexts` centraliza autenticação e empresa ativa. `src/data/providers` é o ponto único de integração com o Base44; repositories em `src/data/repositories` aplicam `company_id` em listagens, criações, atualizações e exclusões. Serviços em `src/services` e `src/lib` concentram regras de venda, estoque, financeiro, compras e orçamentos.

Autenticação segue o mesmo contrato em `src/auth`: o selector usa Supabase Auth quando `VITE_DATA_PROVIDER=supabase` e mantém o adaptador Base44 como fallback. O onboarding cria a primeira empresa pelo RPC `create_company_with_owner`, que usa `auth.uid()` e associa o usuário como administrador dentro de uma transação. O `CompanyContext` só seleciona empresas retornadas pela associação do usuário.

O RPC `finalize_sale` também calcula e grava a comissão na mesma transação da venda quando há vendedor e taxa configurada no produto ou item. `cancel_sale` marca a comissão como `reversed` sem repetir a reversão.

Os módulos de gestão usam `profiles`, `goals` e `notifications`. Operações de membros passam por RPCs `SECURITY DEFINER` que validam associação e role; o frontend nunca consulta `auth.users` diretamente.

O provider atual ainda usa o SDK Base44. Repositories não permitem trocar `company_id` em atualizações e rejeitam operações sem empresa. A camada de cálculos é pura e possui typecheck estrito e testes.

## Etapa 11 — módulos inteligentes

A migration `0010_smart_modules.sql` adiciona conversas, mensagens, oportunidades, automações, execuções idempotentes e insights. Todas as tabelas têm `company_id`, RLS e grants para o Data API.

`conversationsService`, `opportunitiesService`, `automationService` e `intelligenceService` isolam os fluxos das páginas. A automação suporta ações determinísticas de notificação e usa `idempotency_key` em `automation_runs`. O Intelligence atual gera apenas alertas determinísticos de estoque, clientes inativos e contas vencidas; não há IA generativa ou WhatsApp nesta etapa.

## Etapa 12.1 — hardening

A migration `0012_saas_security_hardening.sql` mantém a 0011 intacta e revoga INSERT/UPDATE/DELETE diretos de assinaturas e convites. Policies de leitura são específicas: assinatura para membros ativos e convites para admin/gestor.

Foram adicionados `current_company_role`, `company_within_limit`, `company_has_feature`, `create_company_invite` e `cancel_company_invite`. `accept_company_invite` agora valida o e-mail real em `auth.users`, expiração, uso único, associação existente e limite de usuários, registrando eventos de auditoria sem token.

## Etapa 13

A migration `0013_external_integrations.sql` cria integrações, contatos WhatsApp, configurações de IA, contadores de uso e logs sanitizados, além dos campos de status e ID externo em mensagens. As Edge Functions operam em modo seguro (`WHATSAPP_ENABLED=false`, `AI_ENABLED=false`) até a configuração externa.
