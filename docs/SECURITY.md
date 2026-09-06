# Segurança SaaS

A migration 0012 revoga mutações diretas de subscriptions e invites pelo browser. Criação, cancelamento e aceite de convite passam por RPCs `SECURITY DEFINER`, com `search_path=public`, sessão autenticada, associação ativa, validação de role, e-mail do convite e limite do plano.

O token puro nunca é persistido: o banco recebe somente `token_hash`. Os feature gates no frontend existem apenas para UX e não são fronteiras de segurança; o enforcement mínimo de usuários e automações está nos helpers SQL.

Antes da produção, aplicar a migration, criar a Edge Function server-side para gerar tokens e enviar convites, e testar as policies em duas empresas distintas.

## Etapa 13.1

A migration `0014_integrations_hardening.sql` remove mutações diretas de integrações, configurações de IA, contatos, contadores e logs. Adiciona rate limiting atômico (`consume_rate_limit`) e contadores atômicos (`increment_usage`). A RPC de convite usa `userClient(jwt)` para preservar `auth.uid()`.

O webhook exige `hub.mode=subscribe` no GET e assinatura HMAC `X-Hub-Signature-256` no POST. `whatsapp-send` deriva a empresa pela conversa e valida feature gate; `ai-assistant` exige membership, plano premium, configuração habilitada e `AI_ENABLED=true`. Health check exige autenticação e não revela secrets.
