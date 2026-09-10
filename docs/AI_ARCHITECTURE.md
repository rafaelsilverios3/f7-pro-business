# F7 AI Architecture

## Canonical flow

`request -> F7AIOrchestrator -> intent/domain -> context/research -> decision -> policy -> response -> assisted review or authorized action -> audit`

`F7AIOrchestrator` is the only coordination entry point. Existing provider, research, catalog, and WhatsApp modules remain adapters behind it. Legacy `ai-assistant` and `ai_settings` are compatibility debt and must not receive new behavior.

## Decision contract

Every run produces a trace-scoped decision containing intent, domain, objective, known/discovered/inferred facts, unresolved facts, evidence, candidates, conflicts, confidence, risks, possible and selected actions, human requirement, policy result, and explanation.

In assisted mode, the decision is included in the sanitized model context and returned to the caller. The human still reviews and sends. In automatic mode, `assistant-worker` claims a persisted job atomically and applies an independent policy check; model output never authorizes its own execution.

Smart Atendimento renders the same decision returned by the orchestrator. The editable suggestion shows confidence and the selected next action; “Ver investigação” exposes the trace, structured facts, searches, sources, candidates, scores, policy reason, and execution state. Choosing “Usar resposta” only copies text into the composer. Sending remains an explicit human action.

Legacy direct LLM execution in the inbox was removed so assisted suggestions have one path: `assistant-suggest` → `F7AIOrchestrator` → validated provider response → human review. Candidate confidence aliases from research (`VERIFIED`, `LIKELY`, `DISCOVERED`) are normalized before policy evaluation and cannot silently collapse to insufficient data.

## Current phase boundary

Phases 1–15 centralize orchestration, tools, specialists, research, assisted review, jobs, handoff, verified knowledge, commercial intelligence, automation policy, observability and cost controls. Automatic replies are implemented behind server-side policy and remain disabled by default. Sensitive transactional actions remain blocked until dedicated authorization and atomic RPCs exist.
