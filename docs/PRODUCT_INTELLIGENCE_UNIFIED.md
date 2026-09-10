# Unified Product Intelligence

`resolveProductOrPart` is the single resolver for product and part candidates. It accepts the company catalog, `verified_product_applications`, `part_cross_references`, verified `product_knowledge`, cached research history and current external candidates. Every candidate is normalized by part number, deduplicated and ranked once before it reaches the orchestrator or provider.

Human-verified applications outrank web evidence. Official manufacturer evidence and agreement across independent sources increase confidence, while distinct candidate part numbers remain explicit alternatives. The resolver keeps source references and never converts a web source into an internal catalog source.

No migration is introduced in Phase 10: migrations 0039, 0040 and 0044 already provide the canonical tables. Deployment of the updated `assistant-suggest` must wait until the pending migrations listed in the master plan are applied in order.
