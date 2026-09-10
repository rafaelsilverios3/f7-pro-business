# AI Golden Tests

The executable suite in `tests/ai-golden.test.mjs` bundles the real TypeScript modules and calls their exported functions. It does not duplicate decision or ranking formulas in test code and makes no paid provider calls.

The 7230J benchmark begins without a manufacturer, extracts the model and primary fuel-filter intent, permits research, resolves John Deere and tractor from official-source fixtures, extracts and deduplicates part candidates, ranks corroborated official evidence first, presents options, and leaves PIN as a confirmation question. Additional fixtures cover S540, CH570, 7215J, Compass/year separation, retail isolation, an underspecified generic filter request, next-best-question selection, and grave-conflict policy behavior.

These fixtures prove deterministic parsing, adapter selection, ranking, provenance, and decision behavior. They are not proof that Brave, a manufacturer site, or OpenAI is currently reachable. A controlled production run must separately record the trace from input through Brave results, extraction, candidates, ranking, model context, and assisted response without exposing the customer text or credentials.

## Controlled provider run — 2026-09-09

After deploying only `assistant-suggest`, the 7230J benchmark completed through the production assisted flow. Brave returned public and official John Deere sources; the research engine resolved John Deere, extracted and ranked multiple part candidates, and passed them to the OpenAI context. The generated suggestion presented the candidates with source links and requested the PIN only to resolve the remaining application uncertainty. The operator did not use or send the suggestion.

Verified path: input → Brave → normalized results → candidate extraction → deduplication/ranking → provider context → model → editable assisted response. The rendered sources included `partscatalog.deere.com` as `manufacturer_official`; external sources retained their own domains instead of being relabeled as internal catalog data. Credentials, prompts, customer identifiers, and message content are intentionally absent from this record.

The automatic-reply gate remains closed. This run proves the assisted research path, not authorization for autonomous sending.
