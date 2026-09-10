# Parts Intelligence

Parts Intelligence is a specialist view of the unified Product Intelligence resolver. It does not bypass the canonical orchestrator and it does not embed agricultural behavior in the platform core.

## Flow

`request -> intent -> machine identity -> internal catalog -> web/official research -> candidate extraction -> deduplication -> ranking -> decision -> confirmation or handoff`

Each candidate preserves part number, manufacturer, model/application, system/position, serial range, source type/domain/URL, evidence count, official-source status, trust, confidence and score. Candidates from the internal catalog, verified applications, equivalences, company knowledge, research history and current external research are normalized and merged by one resolver.

Ranking favors official manufacturer evidence, exact application, system and position matches, serial compatibility, agreement across sources, technical description and verified company history. A relevant HIGH or MEDIUM candidate is presented with its uncertainty; missing PIN or serial data is requested only when it distinguishes plausible variants.

## Agricultural benchmark

`AgriculturalPartsSpecialist` and the John Deere official-source adapter are initial plugins in the specialist/source registries. The 7230J benchmark must infer John Deere from research, present supported candidates and request PIN only for final disambiguation. No part number or John Deere rule is hardcoded into the general orchestrator.

## Safety and company scope

External pages are untrusted evidence. They cannot authorize tools or actions. Research is bounded by rounds, queries, results, page fetches, time and cost; company settings can lower the per-run round/query limits. Persisted knowledge and research remain scoped by `company_id`, and only verified human feedback can promote durable company knowledge.
