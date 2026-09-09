# Agricultural Parts Specialist

The agricultural specialist is a domain module selected from company configuration, the customer request, discovered machine identity, and ranked candidates. It covers tractors, sugarcane harvesters, combines, sprayers, planters, platforms, implements, and agricultural engines. Model plus part description is sufficient to start research; manufacturer, PIN, and serial are not universal prerequisites.

Its research flow is request, intent, machine identity, internal search, web search, official-domain search, candidate extraction, deduplication, ranking, cross-checking, presentation, confirmation, and human commercial action. Ranking keeps source authority, exact model/application, system, position, serial range, cross-source evidence, description match, and source trust as separate factors.

`JohnDeereAdapter` is the first manufacturer adapter. It owns Deere aliases, terminology, identity resolution, official-domain priority, and official query construction. The generic research engine contains no Deere part numbers. The adapter does not assume an undocumented manufacturer API; it guides the configured web provider toward `partscatalog.deere.com`, `shop.deere.com`, `deere.com`, and `digitalparts.deere.com` and treats retrieved pages as evidence.

PIN/chassis, serial, system, position, engraved part number, or a photo are requested only when they reduce ambiguity between candidates. The next question prioritizes the attribute that distinguishes remaining variants. No candidate becomes confirmed solely through inference.

Adding another manufacturer requires a new adapter registered in `ManufacturerAdapterRegistry`; it does not require a new assistant or a branch in the generic resolver.
