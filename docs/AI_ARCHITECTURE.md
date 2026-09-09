# F7 AI Architecture

## Canonical flow

`request -> F7AIOrchestrator -> intent/domain -> context/research -> decision -> policy -> response -> assisted review or authorized action -> audit`

`F7AIOrchestrator` is the only coordination entry point. Existing provider, research, catalog, and WhatsApp modules remain adapters behind it. Legacy `ai-assistant` and `ai_settings` are compatibility debt and must not receive new behavior.

## Decision contract

Every run produces a trace-scoped decision containing intent, domain, objective, known/discovered/inferred facts, unresolved facts, evidence, candidates, conflicts, confidence, risks, possible and selected actions, human requirement, policy result, and explanation.

In assisted mode, the decision is included in the sanitized model context and returned to the caller. The human still reviews and sends. In automatic mode, a future job worker must apply an independent policy check; model output never authorizes its own execution.

## Current phase boundary

Phase 1 centralizes the prepared assisted flow and completes the decision shape. Tool selection, specialist registry, persisted investigation state, automatic jobs, handoff, and action execution belong to later gated phases. Automatic replies remain disabled.
