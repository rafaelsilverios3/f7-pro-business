# Edge Functions

As funções em `supabase/functions` são a única camada autorizada a usar `SUPABASE_SERVICE_ROLE_KEY` e secrets externos. `invite-user` gera token aleatório, persiste somente SHA-256 e retorna link; `whatsapp-webhook` valida o desafio Meta, resolve empresa pelo `phone_number_id` e deduplica `external_message_id`; `whatsapp-send` e `ai-assistant` começam bloqueados por segurança; `integration-health` expõe somente flags.

Secrets: `SUPABASE_SERVICE_ROLE_KEY`, `APP_URL`, `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_ENABLED`, `AI_API_KEY`, `AI_ENABLED`. Nunca prefixar secrets com `VITE_`.
