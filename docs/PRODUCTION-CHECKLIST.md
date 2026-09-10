# Production checklist

The authoritative readiness assessment is `PRODUCTION_READINESS.md`.

## Before deploying

- Treat the remote migration ledger as unreconciled: the 2026-09-10 read-only audit returned no recorded versions although the 0041 schema exists.
- Do not use `supabase db push` until a controlled schema-to-ledger reconciliation has been completed.
- Apply 0042, 0043, 0044, 0045 and 0046 manually, in order.
- Keep `automatic_reply_enabled = false` during deployment.
- Configure secrets only in Supabase Edge Functions; never use privileged values in `VITE_*`.
- Run tests, strict/typecheck, lint, build, Edge bundle, migration and frontend-secret validation.
- Confirm the deployed Vercel revision equals the intended `main` SHA.

## After migrations

- Deploy `assistant-suggest`, `assistant-worker`, `whatsapp-webhook`, `whatsapp-send`, `automation-worker`, `ai-run-inspector` and `platform-health`.
- Validate two-company isolation with admin, gestor and restricted users.
- Run the assisted 7230J benchmark through Brave, ranking, OpenAI and human review.
- Verify Realtime and its five-second polling fallback.
- Verify AI budget denial and degraded external-provider fallback.
- Enable automatic reply only for one controlled company after idempotency, low-confidence handoff and one-message/one-response tests pass.

## Release blockers

- A pending migration or failed CI gate blocks dependent deployment.
- A missing secret blocks only its provider; it must not be copied into source code.
- Automatic reply, sensitive automations and transactional actions stay disabled until their policy and smoke-test gates pass.
