# Edge Functions

Supabase Edge Functions are the only application layer allowed to use `SUPABASE_SERVICE_ROLE_KEY` and external provider secrets. The frontend sends the authenticated user's session token to these functions and never calls Meta, OpenAI or Brave directly.

## Current functions

- `assistant-suggest`: canonical assisted orchestrator entry point, bounded research, decision and policy.
- `assistant-worker`: atomic automatic-job worker with retry/idempotency and independent authorization.
- `automation-worker`: server-side trigger/condition/action evaluator; only explicitly safe actions execute.
- `ai-run-inspector`: company-scoped safe trace inspection for admin/gestor.
- `platform-health`: evidence-based provider/platform health without paid probes.
- `whatsapp-webhook`, `whatsapp-send`, `whatsapp-connect`, `whatsapp-disconnect`, `whatsapp-test`: Meta inbound, outbound and lifecycle operations.
- `integration-health`: safe integration state and diagnostics.
- `invite-user`: server-side invitation flow.
- `ai-assistant`: legacy compatibility path; new AI behavior belongs to `assistant-suggest` and the orchestrator.

## Secret boundary

Server-side secrets include `SUPABASE_SERVICE_ROLE_KEY`, `AI_API_KEY`, `WEB_SEARCH_API_KEY`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_APP_SECRET` and `WHATSAPP_VERIFY_TOKEN`. CI scans frontend sources for these identifiers and external provider endpoints.

Every function is bundled during CI. External response bodies, prompts, messages, headers, tokens and keys are excluded from operational traces; only safe status, stage, counts, domains and error codes are retained.
