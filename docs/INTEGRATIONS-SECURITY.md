# Segurança de integrações

RLS continua isolando dados por `company_id`; Edge Functions resolvem a empresa pela sessão ou integração configurada. Tokens, headers de autorização e chaves nunca são registrados. Webhooks e respostas são idempotentes, e rate limiting/usage counters devem ser ampliados antes de habilitar tráfego real.
