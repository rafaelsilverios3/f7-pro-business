# AI Golden Tests

The executable suite in `tests/ai-golden.test.mjs` bundles the real TypeScript modules and calls their exported functions. It does not duplicate decision or ranking formulas in test code and makes no paid provider calls.

The 7230J benchmark begins without a manufacturer, extracts the model and primary fuel-filter intent, permits research, resolves John Deere and tractor from official-source fixtures, extracts and deduplicates part candidates, ranks corroborated official evidence first, presents options, and leaves PIN as a confirmation question. Additional fixtures cover S540, CH570, 7215J, Compass/year separation, retail isolation, an underspecified generic filter request, next-best-question selection, and grave-conflict policy behavior.

These fixtures prove deterministic parsing, adapter selection, ranking, provenance, and decision behavior. They are not proof that Brave, a manufacturer site, or OpenAI is currently reachable. A controlled production run must separately record the trace from input through Brave results, extraction, candidates, ranking, model context, and assisted response without exposing the customer text or credentials.
