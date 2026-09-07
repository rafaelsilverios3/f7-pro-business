
## Status webhook e migration 0016

A migration `0016_whatsapp_delivery_status.sql` adiciona horário e detalhes sanitizados de erro em mensagens e um índice filtrado por status. O webhook processa todas as entradas, alterações, mensagens e statuses do lote, mantém HMAC, idempotência e responde 200 para integrações desconhecidas.

Statuses `sent`, `delivered`, `read`, `failed`, `deleted` e futuros são persistidos sem criar novas mensagens. Mídias ainda não são baixadas; são registradas como placeholders seguros com `message_type` coerente. A migration 0016 deve ser aplicada antes do deploy desta versão. `WHATSAPP_ENABLED` continua false.
