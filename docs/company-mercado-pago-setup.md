# Mercado Pago por empresa

O conector de recebimentos de cada empresa é independente do Billing das assinaturas F7. A integração de pagamentos de Marketplace usa o token OAuth individual do vendedor e nunca usa o token recebedor da plataforma para cobrar uma venda da empresa.

## Configuração segura no Supabase

Cadastre as variáveis abaixo exclusivamente nos segredos das Supabase Edge Functions. Não coloque credenciais no frontend, no GitHub, em logs ou no navegador:

- `MP_COMPANY_CLIENT_ID` e `MP_COMPANY_CLIENT_SECRET`: credenciais de uma aplicação Mercado Pago criada para o modelo Marketplace/recebimentos multiempresa.
- `MP_COMPANY_REDIRECT_URI`: URL exata `https://vwylnjmapixtzhryiutt.supabase.co/functions/v1/mercado-pago-company-callback`, também registrada na aplicação.
- `MP_COMPANY_CONNECTION_ENABLED=true`: libera somente o início e callback OAuth. Não habilita cobranças.
- `MP_COMPANY_ENVIRONMENT=test`: mantém o fluxo no ambiente de teste.
- `APP_ORIGIN=https://f7business.com.br`: origem do retorno após OAuth.

OAuth pode ser configurado e homologado sem habilitar pagamentos. No callback, a troca por credenciais de teste solicita `test_token=true`; a autorização do vendedor é explícita, usa state de uso único, PKCE S256 e confere a identidade do vendedor antes de armazenar os tokens no Supabase Vault.

## Preparar pagamentos de teste

Só depois de conectar uma conta vendedora de teste e configurar o webhook assinado, complete os controles de cobrança:

- `MP_COMPANY_WEBHOOK_SECRET`: segredo de assinatura configurado para esta aplicação e para notificações de pagamentos.
- `MP_COMPANY_PAYMENTS_ENABLED=true`: chave mestre de pagamentos desta integração.
- `MP_COMPANY_TEST_PAYMENTS_ENABLED=true`: gate independente e explícito para cobranças de teste.
- `MP_COMPANY_ENVIRONMENT=test`.

A configuração de pagamento continua desativada se qualquer uma dessas condições faltar. Para habilitar produção, exige-se também `MP_COMPANY_ENVIRONMENT=production` e `MP_COMPANY_PRODUCTION_PAYMENTS_ENABLED=true`; a flag de teste não substitui nem libera o gate de produção. Não habilite esses valores sem autorização financeira específica.

No painel da aplicação Mercado Pago, configure o evento `payment` para `https://vwylnjmapixtzhryiutt.supabase.co/functions/v1/mercado-pago-company-webhook` e associe o segredo do webhook acima. Para testes ponta a ponta, crie/ative contas de teste vendedor, comprador e integrador da mesma região, use cartões de teste e nunca contas ou meios de pagamento reais.

## Escolha da aplicação

A aplicação atual do Billing usa credenciais próprias da plataforma (variáveis `MERCADO_PAGO_*`). Não altere nem reutilize esses segredos para conectar vendedores. Embora o Mercado Pago não documente que Marketplace precise obrigatoriamente de uma segunda aplicação, crie uma aplicação dedicada para recebimentos F7: isso separa redirect URI, configuração Marketplace, webhook e rotação de credenciais do Billing. Configure-a no modelo Marketplace conforme as opções habilitadas para a conta da plataforma.

## Segurança e funcionamento

Tokens de vendedor são salvos somente no Vault via RPCs protegidos. A empresa e o vendedor são verificados no backend; todas as operações financeiras derivam da venda já faturada e permanecem idempotentes. Cartão usa checkout hospedado Mercado Pago e não recebe dados de cartão no F7. PIX e cartão só são oferecidos depois que o ambiente informa pagamentos habilitados.

Desconectar remove a cópia local dos tokens e preserva o histórico. Para retirar também o consentimento concedido ao aplicativo, o administrador revoga o acesso no Mercado Pago.
