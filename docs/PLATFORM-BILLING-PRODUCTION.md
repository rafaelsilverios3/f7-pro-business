# Mercado Pago: preparação para produção

O billing resolve toda a configuração exclusivamente no servidor das Edge Functions. O frontend não escolhe ambiente e nunca recebe `MERCADO_PAGO_ACCESS_TOKEN` ou `MERCADO_PAGO_WEBHOOK_SECRET`.

Secrets usados:

- `MERCADO_PAGO_ENVIRONMENT`: `test` ou `production`.
- `MERCADO_PAGO_ACCESS_TOKEN`: token correspondente ao ambiente ativo.
- `MERCADO_PAGO_WEBHOOK_SECRET`: assinatura correspondente ao ambiente ativo.
- `MERCADO_PAGO_PRODUCTION_PAYMENTS_ENABLED`: trava server-side, com default `false`.

Em `test`, a flag de produção não interfere no sandbox. Em `production`, `billing-health` pode consultar `GET /users/me`, mas `billing-checkout` retorna `PRODUCTION_PAYMENTS_DISABLED` antes de criar checkout ou chamar `POST /v1/orders` enquanto a flag não for exatamente `true`. Assim, o retorno para produção pode ser validado sem criar PIX ou cobrança.

O projeto Supabase mantém um único conjunto ativo de secrets por projeto. Para alternar entre ambientes, o operador deve substituir os três valores Mercado Pago no ambiente server-side; não há seleção de token pelo cliente. O webhook permanece na URL da Edge Function e deve usar a assinatura secreta do mesmo ambiente. O webhook continua exigindo HMAC e consulta o recurso real do provedor antes de qualquer ativação.

Não há configuração de produção aplicada nesta etapa e nenhum pagamento real deve ser criado. A reversão para sandbox consiste em restaurar `MERCADO_PAGO_ENVIRONMENT=test` e os secrets de teste.
