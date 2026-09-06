# Segurança SaaS

A migration 0012 revoga mutações diretas de subscriptions e invites pelo browser. Criação, cancelamento e aceite de convite passam por RPCs `SECURITY DEFINER`, com `search_path=public`, sessão autenticada, associação ativa, validação de role, e-mail do convite e limite do plano.

O token puro nunca é persistido: o banco recebe somente `token_hash`. Os feature gates no frontend existem apenas para UX e não são fronteiras de segurança; o enforcement mínimo de usuários e automações está nos helpers SQL.

Antes da produção, aplicar a migration, criar a Edge Function server-side para gerar tokens e enviar convites, e testar as policies em duas empresas distintas.
