# F7 PRO BUSINESS — Master Audit

Audit date: 2026-09-09  
Audited branch: `main` at `17b18b545b742121e3c480b9f9f9fdb8ad821ccd`  
Migration 0041: reported by the operator as manually applied; remote catalog state was not independently queried in this audit.

## Executive finding

F7 PRO BUSINESS is a functional multi-company SaaS with broad ERP/CRM coverage, a real WhatsApp inbox, an assisted OpenAI flow, and a Brave-backed product research path. It is not yet an autonomous business AI platform. The current AI path is concentrated in `assistant-suggest`, while the recently introduced `AssistantDecision` and `assistant_jobs` are partial foundations that do not control execution. Automatic reply must remain disabled until the orchestrator, policy engine, worker, handoff, and idempotent send contract are complete.

The main architectural risks are duplication between the legacy `ai_settings`/`ai-assistant` path and the current `company_assistant_settings`/`assistant-suggest` path, source and specialist rules embedded in a large Edge Function, source trust reduced to domain heuristics, and tests that mostly inspect source text rather than exercise runtime behavior.

## What exists

### Frontend

- React 18, Vite 6, React Router, TanStack Query, Tailwind/Radix components.
- Public institutional site, authentication, onboarding, company context, role guards, and SPA rewrites for Vercel.
- Operational modules: Dashboard, Customers, Products, Inventory, Sales, POS, Pricing, Finance, Quotes, Purchases, Goals/Commissions, Reports, Notifications, Users, and Settings.
- Smart modules: Smart Atendimento, Automations, Product/Business Intelligence, Opportunity, Supplier Intelligence, Market Intelligence, Sales Hub, AI Sales, and Opportunity Radar.
- A dual data-provider abstraction remains: Supabase is selected by `VITE_DATA_PROVIDER`; Base44 adapters are still present.
- Smart Atendimento supports real WhatsApp text/media, manual replies, delivery state, Realtime plus polling fallback, and assisted suggestion review.
- Assistant configuration supports company profile, tone, language, business hours, commercial policies, important information, specific rules, quick replies, handoff rules, and manual/assisted selection.

### Backend and Edge Functions

- Supabase Edge Functions for WhatsApp connect/test/disconnect/send/webhook/health, invites, `assistant-suggest`, and legacy `ai-assistant`.
- Server-side secrets are used for Meta, OpenAI, Brave, and service-role operations.
- `assistant-suggest` performs authentication, membership, feature entitlement, rate limiting, context lookup, internal product matching, conditional Brave research, candidate extraction/ranking, structured OpenAI output, and safe trace logging.
- `_shared/webResearch.ts` provides Brave and generic public search adapters, SSRF controls, bounded page retrieval, iterative query refinement, evidence extraction, candidate deduplication, and a limited machine identity resolver.
- `_shared/productIntelligence.ts` provides internal catalog resolution and a preliminary candidate model.
- `_shared/officialSources.ts` provides a small official-source registry, including John Deere.
- `_shared/assistantDecision.ts` provides a preliminary decision function.

### Supabase data model

- Core ERP/CRM tables are company-scoped and protected by RLS policies.
- Integration tables cover WhatsApp configuration, contacts, usage, rate limits, and logs.
- Smart Atendimento tables include conversations, messages, opportunities, automations, automation runs, and intelligence insights.
- Intelligence tables exist for products, product research, verified applications, cross references, suppliers, market signals, opportunities, sales channels, and pricing history.
- `company_assistant_settings`, `company_quick_replies`, and `company_handoff_rules` are the current assistant configuration model.
- `assistant_jobs` and automatic configuration columns were added by migration 0041.

### Tests and delivery

- GitHub Actions runs `npm ci`, tests, strict typecheck, normal typecheck, lint, and build.
- The repository contains 202 Node tests across business calculations, repositories, security, RLS migrations, WhatsApp, assistant, and intelligence modules.
- Vercel serves the SPA and preserves static assets.

## What works

- Authenticated company selection and role-aware routing.
- Company-scoped CRUD for the main ERP/CRM modules.
- Transactional sales/POS flows and supporting stock/finance structures.
- WhatsApp connection validation, inbound webhook persistence, private media storage, manual outbound replies, delivery callbacks, safe diagnostics, and inbox synchronization.
- Assisted AI feature gate, company membership validation, server-side context loading, OpenAI Structured Outputs validation, safe provider error mapping, and human review before send.
- Brave Search uses the official endpoint contract with server-side credentials, request limits, timeout handling, result normalization, SSRF protection, and sanitized diagnostics.
- Product research can start with a model plus part description; PIN/chassis is not a prerequisite for beginning the search.
- Public site/app route separation and production SPA routing.

## What is partial

### AI orchestration

- There is no `F7AIOrchestrator`. Intent detection, context loading, research, prompt construction, provider calls, policy hints, and logging remain coupled inside `assistant-suggest`.
- `AssistantDecision` contains only a subset of the required contract. It lacks trace, domain, objective, provenance-rich facts, evidence, conflicts, risks, policy result, explanation, and a formal selected/possible-action distinction.
- The decision is calculated after research but does not drive tool selection, provider instructions, response validation, or handoff. It is returned as extra metadata only.
- `automaticReplyEnabled` is hardcoded `false` in `assistant-suggest`, which is safe but proves the new settings are not wired.

### Research engine

- Research is bounded and iterative, but still implemented as a search helper rather than a reusable orchestration engine.
- Machine identity discovery recognizes a small hardcoded manufacturer list. This is unsuitable as the universal specialist architecture.
- Provenance exists only in the recent research state and does not consistently include timestamp, canonical source, verification actor, or company scope.
- Source trust is derived mostly from domain matching and simple source types. Reputation, source age, cross-source agreement, counterfeit signals, and claim-level evidence are not modeled.
- Candidate extraction is regex-based. It can miss unlabelled valid part numbers and can still accept contextually weak alphanumeric strings.
- Research cache writes are best effort and errors are swallowed, reducing observability of cache/data failures.

### Assistant jobs and automatic mode

- Migration 0041 creates `assistant_jobs`, but the webhook does not enqueue jobs and no worker claims or processes them.
- Job states differ from the master contract (`queued/processing/completed/failed/handed_off` versus `PENDING/PROCESSING/WAITING_INPUT/COMPLETED/FAILED/HANDOFF`).
- Missing fields: `message_id`, `attempt_count`, `started_at`, `finished_at`, `trace_id`, and `error_code`.
- The unique `(company_id, provider_message_id)` constraint is a sound idempotency base, but there is no atomic claim function, retry/lease model, response reservation, or proof that one inbound message produces at most one outbound response.
- The frontend intentionally forces saved mode to manual or assisted and displays automatic as blocked.

### Handoff and memory

- Handoff rules are prompt/context inputs only. There is no persisted handoff dossier or workflow state.
- Conversation messages provide short-term context, but no durable investigation state supports progressive elimination or continuation after customer clarification.
- No feedback records exist for accepted, edited, rejected, or corrected suggestions.

### Observability and costs

- Research trace IDs and safe stage logs exist, but there is no unified trace spanning inbound message, research, model request, decision, outbound send, and handoff.
- No AI Run Inspector exists in the frontend.
- Usage counters and rate limits exist, but there is no per-company token/query/cost budget enforcement for AI research.
- Integration health exists for WhatsApp; OpenAI, Brave, Realtime, and AI orchestration do not share a common health model.

## What is broken or inconsistent

1. Legacy and current AI stacks coexist:
   - `ai_settings` plus `ai-assistant` use the old model.
   - `company_assistant_settings` plus `assistant-suggest` use the current model.
   - The old Edge Function can report readiness independently of the real assistant configuration.
2. Assistant settings UI still resolves membership locally and falls back to `user.role`; this duplicates the centralized membership hook used elsewhere.
3. `RoleGuard` performs its own membership query instead of using the shared company-membership source.
4. The assistant settings service accepts `automatic` in validation, while the UI save handler rewrites it to manual. The contract is inconsistent by layer.
5. The recently created job migration is applied according to operator report, but no application code uses it.
6. `AssistantDecision` labels a result eligible only by candidate confidence and conflict. It does not enforce action sensitivity, business hours, channel state, source quality, company permissions, or transaction policy.
7. `assistant-suggest` logs two families of stage names (`assistant_suggest_stage` and product-intelligence events) without a canonical trace schema.
8. Business-specific guidance and generic provider safety rules are mixed in one prompt builder, making priority and regression analysis difficult.

## What is missing

- Central `F7AIOrchestrator` and a formal pipeline contract.
- Tool registry with schemas, scopes, permissions, timeouts, failure modes, and audit events.
- Specialist registry with company-configured, message-derived domain selection.
- Reusable research engine with claim-level provenance and measurable information gain.
- Policy engine that authorizes each action independently from model output.
- Persisted investigation state and progressive candidate elimination.
- Atomic assistant job claim/retry/idempotent response mechanism.
- Structured handoff dossier and human continuation workflow.
- Knowledge layer and controlled feedback loop.
- AI Run Inspector, unified health, and company cost controls.
- Runtime integration tests for Edge Functions. Current tests predominantly match source strings and migration text.
- Controlled real Brave/OpenAI golden run evidence. Fixtures are present but are not production proof.

## Architectural risks

- The large `assistant-suggest` function is a change hotspot and makes phase-specific tests hard.
- Adding a second orchestrator without retiring the legacy paths would create a third AI architecture. The final design must extract and replace, not wrap indefinitely.
- Domain-specific rules embedded in global functions can leak assumptions between company segments.
- Dual Base44/Supabase paths expand the test surface and allow behavior drift.
- Best-effort persistence with empty catch blocks can hide operational failures.

## Security risks

- No frontend service-role exposure was found. Meta/OpenAI/Brave credentials remain server-side.
- SSRF checks block private IPv4 ranges and common local hosts; DNS rebinding and resolved-IP validation are not implemented.
- External page content is explicitly untrusted in the prompt, but tool-level prompt injection classification is absent.
- `assistant_jobs` denies anon/authenticated access and grants only service-role read/write, which is conservative. A future inspector will require a safe RPC or company-scoped read policy rather than direct privileged access.
- Automatic actions have no policy engine; enabling them now would be unsafe.
- Several SECURITY DEFINER functions and historical grants need an object-by-object review before production hardening.

## Data risks

- Migration state is tracked by files, but remote application state is not recorded in the repository. Migration 0041 is only operator-confirmed here.
- There is a migration numbering gap at 0022. It is not inherently unsafe but complicates operational audit.
- The legacy `ai_settings` table can drift from `company_assistant_settings`.
- Research evidence is stored as JSON without a versioned claim schema.
- No retention policy is defined for messages, media, traces, research pages, jobs, or model observations.

## AI risks

- Candidate confidence currently combines simple heuristics and is not calibrated against accepted/rejected outcomes.
- The model still generates the natural-language answer; the preliminary decision does not constrain it strongly enough.
- A candidate can be presented with weak evidence if extraction/ranking is wrong.
- `technicalMissingInformation` uses regex heuristics and may over-request confirmation fields.
- The OpenAI response schema validates shape but not factual correspondence to provided candidates/sources.
- There is no explicit post-generation grounding validator.

## Integration risks

- WhatsApp is the most mature integration, but automatic AI execution is not connected to inbound processing.
- The webhook correctly returns 200 for item-level failures; a future job enqueue failure needs explicit durable diagnostics and retry strategy.
- Brave availability degrades to internal context, but the UI does not clearly distinguish research unavailable from no external evidence.
- Realtime uses both subscription and polling for reliability, increasing load and requiring future health/cost tuning.

## Technical debt

- Retire or migrate `ai-assistant` and `ai_settings` after compatibility analysis.
- Centralize company membership resolution in route guards and assistant settings.
- Split `assistant-suggest` into orchestrator, context, research, policy, provider, and audit modules.
- Replace source-code regex tests with executable unit tests for pure modules and contract tests for Edge handlers.
- Version trace, evidence, decision, and job payload schemas.
- Document remote migration/deploy state in a production ledger.

## Module status matrix

| Area | Status | Evidence / limitation |
|---|---|---|
| Auth / company membership | Working, duplicated | Auth and company guards work; role lookup is repeated in multiple components. |
| RLS / permissions | Broadly working | Company policies and permission tests exist; full SECURITY DEFINER/grant audit remains. |
| Plans / feature flags | Working | Entitlements and company overrides exist; new autonomous capabilities are not yet modeled individually. |
| ERP / CRM / POS | Working foundation | Main CRUD and transactional paths exist; autonomous tools are not registered. |
| WhatsApp inbound/outbound | Working human flow | Real inbound, media, manual send, statuses, and diagnostics exist. |
| Smart Atendimento | Working assisted inbox | Assisted suggestions and human send work; investigation inspector is absent. |
| OpenAI | Working assisted provider path | Structured output and safe errors exist; grounding validator and cost accounting are absent. |
| Brave / web research | Partial but operational | Real adapter and bounded research exist; source trust and generalized identity resolution are incomplete. |
| Product Intelligence | Partial | Internal/external candidates exist; knowledge and verification lifecycle are incomplete. |
| Decision engine | Prototype | Returned but not authoritative. |
| Assistant jobs | Schema only | No enqueue, claim, worker, retry, send, or completion flow. |
| Automatic mode | Blocked | Correct current state. Must remain blocked until phases 1–8 pass. |
| Handoff | Configuration only | No dossier or persisted transition. |
| Observability | Partial | Safe logs and research trace exist; no full-run trace or inspector. |
| Cost control | Missing | Rate limits exist; token/query/cost budgets do not. |
| CI | Working | Quality gates run on push/PR; no Edge bundle or database integration job. |
| Deployment | Partial documentation | Vercel and Supabase are documented separately; no authoritative deployment ledger. |

## Audit of recent commits

### `0d459ab` — autonomous assistant foundation

Preserve:

- automatic reply default false;
- service-role-only job access;
- company/provider-message uniqueness;
- explicit distinction between response automation and transaction automation.

Refactor:

- expand the decision schema;
- make the decision authoritative through policy and response stages;
- replace job schema/state names with the final contract via a new migration;
- add atomic job claim/idempotency functions;
- do not wire automatic mode until the required gates pass.

### `17b18b5` — research trace and candidate priority

Preserve:

- `research_trace_id`;
- separation of search and confirmation gaps;
- safe candidate/source summaries;
- explicit candidate-first instruction.

Refactor:

- use one canonical trace event schema;
- move tracing into the orchestrator;
- ensure every provider, decision, policy, response, send, and handoff event shares the same trace;
- replace prompt-only priority enforcement with a post-generation grounding validator.

## Required architectural direction

One path must become authoritative:

`Inbound or assisted request -> F7AIOrchestrator -> intent/domain -> specialist -> tool policy -> context -> research -> evidence/candidates -> decision -> policy -> response -> human review or authorized send -> audit/handoff/knowledge`

The orchestrator must reuse the working auth, company scope, research adapters, WhatsApp send logic, and provider validation. It must replace the coordination currently embedded in `assistant-suggest`; it must not run beside it as an unrelated second flow.

## Phase gates

1. Phase 1 may extract a formal orchestrator and complete decision contract while keeping assisted behavior unchanged.
2. Phase 2 may register read-only tools and specialists. Transactional tools remain policy-blocked.
3. Phase 3 must establish evidence/provenance/source-trust contracts and a reusable research loop.
4. Phase 4 may implement the agricultural benchmark through a specialist adapter, with no hardcoded PN.
5. Phase 5 migrates assisted Smart Atendimento to the orchestrator.
6. Phase 6 requires executable golden tests and a controlled real-provider test when secrets/environment are available.
7. Phase 7 may complete jobs and auto-reply only after phases 1–6 pass.
8. Phase 8 must persist handoff dossiers before automatic low-confidence operation.
9. Later phases add knowledge, unified intelligence, automation, observability, budgets, and production hardening.

## Preliminary production readiness score

| Dimension | Score | Rationale |
|---|---:|---|
| Auth | 82 | Real auth/membership path exists; duplicate role resolution remains. |
| Security | 74 | Server-side secrets, RLS, validation, and rate limits exist; autonomous policy and full grant review are missing. |
| RLS / multitenancy | 80 | Strong company scoping and tests; new inspector/knowledge/job read paths are not designed. |
| AI | 48 | Assisted generation works; orchestration, grounding, specialists, policy, and feedback are incomplete. |
| Research | 58 | Brave and iterative lookup work; trust/provenance and real golden proof are incomplete. |
| Auto reply | 10 | Schema foundation only; safely disabled. |
| Observability | 45 | Safe stages and traces exist, but no unified run model or inspector. |
| Cost control | 25 | Rate limiting exists; explicit AI/web/token/cost budgets do not. |
| Integrations | 72 | WhatsApp is functional; cross-module agent tools are absent. |
| Testing | 58 | Broad static/regression coverage; runtime integration and Edge bundle gates are missing. |
| Failover | 42 | Internal fallback/polling exist; durable job retries and provider health policy are missing. |

Overall preliminary readiness: **54/100**. This is a usable human-operated SaaS with assisted AI, not yet a production-ready autonomous agent platform.

## Phase 0 conclusion

Phase 0 is complete as a repository audit. No production code was changed during this phase. The next safe implementation is Phase 1: define the canonical orchestrator and decision contracts, extract coordination from `assistant-suggest`, preserve assisted behavior, and keep automatic reply disabled.
