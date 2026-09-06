# Migração de backend

Para migrar para uma API própria, implemente outro provider com os mesmos métodos de `base44Provider.entity(name)` e troque a composição dos repositories. As páginas e serviços devem continuar usando repositories/services, sem conhecer o SDK.

O Base44 atual não oferece uma transação ACID garantida para a sequência venda → estoque → financeiro → cliente → comissão. Os serviços fazem pré-validação, chaves de idempotência quando disponíveis e retornam erro explícito; a migração futura deve envolver essas etapas em transações no Postgres.
