# F7 Research Engine

Research starts from technical intent rather than mandatory fields. `ResearchState` records the original request, current objective, known and discovered facts, unresolved facts, executed queries, sources, candidates, evidence, conflicts, confidence, and the next research step. Customer facts remain separate from facts discovered through official or public sources, and every fact carries provenance, source, confidence, and timestamp.

The loop is bounded by `MAX_RESEARCH_ROUNDS`, `MAX_WEB_QUERIES`, `MAX_TOTAL_RESULTS`, `MAX_PAGE_FETCHES`, `MAX_RESEARCH_DURATION_MS`, and `MAX_RESEARCH_COST`. After each query it updates machine identity, evidence, candidates, confidence, and the next research step. It stops when a strong cross-sourced candidate exists, an official source confirms a candidate, repeated searches add no evidence, the budget expires, sources are exhausted, or customer-only information is needed.

Source trust is separate from product confidence. It evaluates authority, domain, official status, company identity, reputation data, review volume and patterns, complaints, delivery issues, counterfeit claims, description mismatch, price anomalies, source age, and cross-source agreement when those signals are available. Missing signals stay unknown rather than being invented. Manufacturer-official sources start at the highest authority, approved catalogs and distributors follow, and generic public sources remain lower trust until corroborated. This score does not assert that a supplier is safe or fraudulent.

Allowed provenance values are `customer`, `company_internal`, `official_source`, `public_web`, `human_agent`, `historical_verified`, and `inference`. Inference is never promoted to confirmed evidence.

Web content remains untrusted data. It cannot change system rules, choose tools, authorize actions, expose secrets, or cross company boundaries.
