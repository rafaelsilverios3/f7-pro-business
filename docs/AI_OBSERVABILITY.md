# Observabilidade da IA

Cada execução recebe um `trace_id` e atualiza `ai_runs`; `ai_run_events` preserva a sequência de estágios. O inspetor exibe somente etapa, estado, ferramentas, contagens, domínios das fontes, confiança, tokens, custo estimado, duração e código de erro seguro. Prompts, mensagens, cabeçalhos e credenciais não fazem parte do schema.

Estágios canônicos: `REQUEST_RECEIVED`, `INTENT_RESOLVED`, `DOMAIN_SELECTED`, `CONTEXT_READY`, `TOOLS_SELECTED`, `RESEARCH_STARTED`, `RESEARCH_COMPLETED`, `CANDIDATES_READY`, `DECISION_READY`, `POLICY_CHECKED`, `RESPONSE_CREATED`, `RESPONSE_SENT`, `HANDOFF_CREATED`, `COMPLETED` e `FAILED`. Uma execução pode omitir um estágio quando a etapa não se aplica, mas nunca deve alterar o resultado comercial por falha de telemetria.

`platform-health` usa evidência operacional recente e não faz chamadas pagas. OpenAI, Brave, WhatsApp e Webhook ficam `UNKNOWN` sem evidência, `HEALTHY` após sucesso recente e `DEGRADED` após falha recente. Supabase e Edge Functions refletem a própria consulta; Realtime exige evidência do cliente e permanece `UNKNOWN` no backend.

Para rollback, desative as funções dependentes, exporte resumos necessários e remova a migration 0046 de forma manual. Nunca apague logs como parte de rollback operacional.
