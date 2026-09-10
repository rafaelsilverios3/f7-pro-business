# Production Readiness

## Score

| Dimension | Score | Evidence and remaining risk |
|---|---:|---|
| AUTH | 88 | Supabase session, active membership and company role are verified server-side. Final role matrix smoke test remains manual. |
| SECURITY | 84 | Secrets stay server-side, external content is untrusted, rate limits and safe errors exist. Pending migrations must be applied in order. |
| RLS | 86 | New tables have company-scoped policies and anon is revoked. Remote policies for 0042–0046 are not active yet. |
| MULTITENANCY | 88 | Company IDs, composite ownership checks and scoped queries are covered by tests. Remote cross-company smoke test remains required. |
| AI | 82 | One orchestrator, formal decision, strict provider output and human policy. Automatic mode remains disabled by default. |
| RESEARCH | 84 | Bounded Brave research, SSRF protection, provenance, source trust and golden/real benchmark evidence exist. Provider availability is external. |
| AUTO_REPLY | 60 | Atomic jobs, retry, idempotent delivery and handoff are implemented. 0042/0043 and worker deployment are pending. |
| OBSERVABILITY | 62 | Trace schema, inspector and health endpoint are implemented. 0046 and endpoints are pending deployment. |
| COST | 62 | Atomic per-company budgets are implemented. 0046 is pending and cost rate must be configured per company. |
| INTEGRATIONS | 78 | WhatsApp inbound, media, manual outbound and safe health are covered. New platform endpoints remain pending. |
| TESTING | 94 | Unit/regression tests, strict/typecheck/lint/build and every Edge bundle run in CI. Real automatic reply is intentionally not executed. |
| FAILOVER | 68 | Research falls back to internal data, polling covers Realtime and jobs retry. No external multi-provider AI/search failover exists. |

**Overall readiness: 74/100.** The application is suitable for controlled assisted operation. Automatic operation is not production-ready until the manual deployment sequence and smoke tests below pass.

## DEPLOY REQUIRED

Remote read-only audit on 2026-09-10 found an empty Supabase migration-history ledger, while the schema contains the 0041 `assistant_jobs` foundation and does not contain the 0042 worker columns/RPCs, 0043 handoffs, 0044 knowledge/feedback or 0046 observability tables. This confirms manual SQL application outside migration history.

Do not run `supabase db push` against this state: it would treat every local migration as pending. Apply manually, in order: `0042_assistant_job_execution.sql`, `0043_structured_assistant_handoffs.sql`, `0044_company_knowledge_feedback.sql`, `0045_automation_engine_hardening.sql`, `0046_ai_observability_cost_health.sql`. Reconcile the migration ledger only as a separate controlled DBA operation after comparing the full remote schema.

After migrations, deploy: `assistant-suggest`, `assistant-worker`, `whatsapp-webhook`, `whatsapp-send`, `automation-worker`, `ai-run-inspector`, and `platform-health`. Deploy `integration-health` only if its deployed revision differs from `main`.

Confirm the Vercel deployment contains the final `main` SHA. A Git push alone is not proof of a successful production deployment.

## Required smoke tests

1. Admin, gestor and restricted roles in two companies; confirm cross-company denial.
2. Assisted 7230J test from inbound WhatsApp through Brave, ranking, OpenAI, editable suggestion and manual send.
3. Automatic mode still disabled after migrations.
4. Enable automatic reply only for a controlled company, then verify one inbound message produces at most one response.
5. Low confidence and source conflict create a resumable handoff without sending.
6. AI budget denial prevents external calls and leaves human handling available.
7. Realtime event plus five-second polling fallback.
8. AI Run Inspector and platform health expose counts/codes only, with no message or credential data.

## Known limitations

- No second OpenAI-compatible or web-search provider is configured for failover.
- Cost is estimated only after `estimated_cost_per_1k_tokens` is configured; calls, queries and tokens are limited independently.
- Sensitive automation actions remain blocked pending dedicated authorization policies and transactional RPCs.
- Sales Hub connectors require official provider integrations; scraping/publication is not assumed.
