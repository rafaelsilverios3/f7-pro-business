# F7 PRO BUSINESS — Master Plan

The implementation follows the master directive in isolated phases. Automatic reply remains disabled until research, policy, jobs, handoff, and golden tests are complete.

| Phase | Objective | Exit gate |
|---|---|---|
| 0 | Repository and production-readiness audit | `MASTER_AUDIT.md`, quality gates, isolated commit |
| 1 | Canonical orchestrator and decision contract | Assisted flow uses `F7AIOrchestrator`; automatic remains blocked |
| 2 | Tool and specialist registries | Registered read-only tools and segment specialists with schemas/policies |
| 3 | Research, provenance, and source trust | Claim-level evidence, bounded loop, source scoring |
| 4 | Agricultural specialist and John Deere adapter | 7230J benchmark architecture without hardcoded PN |
| 5 | Smart Atendimento on the orchestrator | Assisted UI consumes decision/trace and preserves human review |
| 6 | Golden and controlled real-provider tests | Runtime fixtures plus documented Brave/OpenAI controlled run |
| 7 | Jobs and auto reply | Implemented locally: atomic claim, bounded retry state, idempotent response, independent policy authorization; migration 0042 awaits manual application |
| 8 | Structured handoff | Implemented locally: persisted dossier, atomic assignment and resumable human workflow; migration 0043 awaits manual application |
| 9 | Knowledge and feedback loop | Implemented locally: verified company knowledge plus immutable human feedback; migration 0044 awaits manual application |
| 10 | Unified Product Intelligence | Implemented: one resolver merges catalog, verified applications, equivalences, knowledge, research history and external evidence |
| 11 | Supplier, market and opportunity intelligence | Unified company-scoped commercial signals and read-only orchestrator tools |
| 12 | Pricing and CRM intelligence | Cost-aware recommendations and company-scoped customer/sales signals |
| 13 | Automation engine | Server-side trigger/condition/action policy with stable idempotency; migration 0045 pending |
| 14 | Observability, cost control and health | Trace inspector, atomic budgets and platform health; migration 0046 pending |
| 15 | Production hardening | CI bundles every Edge Function, validates migrations/secrets and records honest readiness blockers |

Every phase runs tests, both typechecks, lint, build, and Edge bundle validation when Edge code changes.

## Deployment boundary

Phases 0–15 are implemented in `main`. Migrations 0042–0046 remain manual and must be applied in order before their dependent Edge Functions are deployed. Automatic reply remains disabled by default and requires a controlled smoke test before company-level activation.
