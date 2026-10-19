# Mercado Pago: preparação para produção

O billing resolve toda a configuração exclusivamente no servidor das Edge Functions. O frontend não escolhe ambiente e nunca recebe `MERCADO_PAGO_ACCESS_TOKEN` ou `MERCADO_PAGO_WEBHOOK_SECRET`.

Secrets usados:

- `MERCADO_PAGO_ENVIRONMENT`: `test` ou `production`.
- `MERCADO_PAGO_ACCESS_TOKEN`: token correspondente ao ambiente ativo.
- `MERCADO_PAGO_WEBHOOK_SECRET`: assinatura correspondente ao ambiente ativo.
- `MERCADO_PAGO_PRODUCTION_PAYMENTS_ENABLED`: trava server-side, com default `false`.
- `MERCADO_PAGO_AI_CREDITS_ENABLED`: trava independente dos pacotes F7 AI Credits, com default `false`.

Em `test`, a flag de produção não interfere no sandbox. Em `production`, `billing-health` pode consultar `GET /users/me`, mas `billing-checkout` retorna `PRODUCTION_PAYMENTS_DISABLED` antes de criar checkout ou chamar `POST /v1/orders` enquanto a flag não for exatamente `true`. Assim, o retorno para produção pode ser validado sem criar PIX ou cobrança.

Os planos usam `MERCADO_PAGO_PRODUCTION_PAYMENTS_ENABLED`. A rota de pacotes F7 AI Credits também exige `MERCADO_PAGO_AI_CREDITS_ENABLED=true`; ausente ou diferente de `true`, recusa a solicitação antes de gravar uma compra ou chamar o Mercado Pago. Portanto, habilitar pagamentos dos planos não libera os pacotes. Para o primeiro lançamento, mantenha a trava de créditos ausente/desligada; a publicação do F7 AI Credits não autoriza sua venda.

Checkout e webhook verificam a identidade do token em uma chamada somente leitura a `/users/me` do Mercado Livre, exigindo site brasileiro e identidade de teste quando o ambiente é `test`; o prefixo isolado do token não determina o ambiente, pois tokens de teste podem usar `APP_USR-`. Em `production`, uma identidade de teste é recusada e a trava explícita continua obrigatória. O webhook ainda exige que `live_mode` corresponda ao ambiente antes de consultar e processar o recurso.

A versão local do protocolo de billing usa `get_or_create_billing_checkout` para serializar checkouts e `persist_billing_checkout_order` para gravar a ordem e o pagamento pendente na mesma transação. `settle_billing_webhook_event` valida e liquida a confirmação em uma transação separada. Essas RPCs são exclusivas de `service_role`. A migration `20261015154213_billing_webhook_atomic_settlement.sql` está preparada e validada apenas no banco Supabase local isolado; ela ainda precisa de aprovação e aplicação em homologação antes de publicar handlers que a invoquem.

O projeto Supabase mantém um único conjunto ativo de secrets por projeto. Para alternar entre ambientes, o operador deve substituir os três valores Mercado Pago no ambiente server-side; não há seleção de token pelo cliente. O webhook permanece na URL da Edge Function e deve usar a assinatura secreta do mesmo ambiente. O webhook continua exigindo HMAC e consulta o recurso real do provedor antes de qualquer ativação.

Não há configuração de produção aplicada nesta etapa e nenhum pagamento real deve ser criado. A reversão para sandbox consiste em restaurar `MERCADO_PAGO_ENVIRONMENT=test` e os secrets de teste.
