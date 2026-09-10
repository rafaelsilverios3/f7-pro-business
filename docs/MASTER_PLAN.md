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
| 11–15 | Supplier/market/opportunity, pricing/CRM, automation, observability and hardening | Individual commits, migrations, tests, and deployment records |

Every phase runs tests, both typechecks, lint, build, and Edge bundle validation when Edge code changes.
