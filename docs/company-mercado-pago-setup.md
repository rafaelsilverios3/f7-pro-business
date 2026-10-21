# Mercado Pago por empresa

O conector de recebimentos das empresas é independente do Billing das assinaturas F7. O F7 nunca usa o token recebedor da plataforma para cobrar uma venda de empresa.

## Configuração do ambiente seguro

Cadastre os valores abaixo como segredos das Supabase Edge Functions, nunca no frontend:

- `MP_COMPANY_CLIENT_ID` e `MP_COMPANY_CLIENT_SECRET`: aplicação OAuth criada no Mercado Pago Developers.
- `MP_COMPANY_REDIRECT_URI`: URL exata `https://vwylnjmapixtzhryiutt.supabase.co/functions/v1/mercado-pago-company-callback`, também registrada na aplicação OAuth.
- `MP_COMPANY_WEBHOOK_SECRET`: chave secreta de assinatura das notificações do Mercado Pago.
- `MP_COMPANY_PAYMENTS_ENABLED=true`: habilita o conector depois de validar as configurações acima.
- `MP_COMPANY_ENVIRONMENT=test` para credenciais de teste. Cobranças online em produção continuam bloqueadas.
- `APP_ORIGIN=https://f7business.com.br` para o retorno pós-autorização.

O retorno OAuth usa estado de uso único, PKCE S256 e validação do ID do vendedor antes de guardar tokens no Supabase Vault. A conta precisa ser autorizada por um administrador/gestor/financeiro da própria empresa.

No painel Mercado Pago Developers, configure notificações `payment` para `https://vwylnjmapixtzhryiutt.supabase.co/functions/v1/mercado-pago-company-webhook` e use a chave de assinatura correspondente em `MP_COMPANY_WEBHOOK_SECRET`.

## Habilitação de produção

Para habilitar pagamentos reais em produção, depois de testes aprovados e autorização financeira específica, configure `MP_COMPANY_ENVIRONMENT=production` e `MP_COMPANY_PRODUCTION_PAYMENTS_ENABLED=true`. Enquanto essa chave não for habilitada, tentativas de cobrança retornam bloqueio seguro, mesmo que uma conta OAuth esteja conectada.

Pix usa o endpoint de pagamento da conta OAuth da empresa. Cartões usam Checkout Pro hospedado pelo Mercado Pago; os dados do cartão não transitam pelo F7. O valor é derivado do recebível já faturado, cada tentativa tem chave idempotente, e a baixa financeira ocorre somente após consulta autenticada ou webhook assinado que confira vendedor, transação, BRL e valor.
