# Conector Mercado Livre

Implementação server-side para o Sales Hub. OAuth tokens e estados ficam em tabelas privadas, fora do navegador e de `sales_channels.metadata`. Operações de consulta são sob demanda; envio de preço/estoque exige papel de gestão, vínculo prévio do anúncio, confirmação explícita e chave idempotente. Importar pedido grava apenas o resumo sem dados do comprador e não cria venda, estoque ou lançamento financeiro.

## Fluxos

- `mercadolivre-connect` verifica JWT Supabase, vínculo ativo em `company_users` e papel admin/gestor/comercial, grava o hash de um state aleatório de 10 minutos e devolve URL OAuth.
- `mercadolivre-callback` troca o código no servidor, consome o state uma única vez, confirma `/users/me`, cifra tokens AES-GCM e registra somente metadados seguros.
- `mercadolivre-api` valida o membro e o papel em cada chamada, renova token rotativo por lease transacional, sincroniza no máximo 20 anúncios por chamada, importa até 50 pedidos e permite mapear produto antes de enviar preço/estoque.
- `mercadolivre-webhook` valida application id, tópico, vendedor conectado e caminho de recurso; limita payload e fila. Armazena apenas o ponteiro do evento. O processamento consulta o recurso canônico autenticado na API e usa upserts idempotentes, com retentativas e dead-letter.

As notificações descritas pelo Mercado Livre são recebidas como ponteiros JSON. O handler não confia no corpo para gravar pedidos ou anúncios; cada recurso é recuperado com o access token da conta vinculada. O endpoint público não pode atestar a origem criptograficamente apenas pelo `application_id`; o mapeamento do vendedor, o app id e a releitura autenticada reduzem o risco de falsificação, mas não eliminam abuso de disponibilidade. A fila tem deduplicação, limite por empresa, payload máximo e retentativa limitada.

## Operações e limites

- Consultas: status, listagem/sincronização de anúncios, importação/listagem de pedidos e processamento de notificações.
- Anúncio: o vínculo entre anúncio e produto é manual. O envio usa os valores atuais de preço/estoque do produto da mesma empresa; estoque fracionário é recusado, nunca arredondado. A execução envia apenas os campos escolhidos e exige confirmação do usuário e chave UUID de idempotência.
- Desconexão: apaga os tokens mantidos pelo F7 e marca a conta desconectada. O usuário também deve revogar a autorização no Mercado Livre; o conector não declara ter revogado a concessão externa.
- Não são criadas vendas, compras, movimentos de estoque ou lançamentos financeiros. Não há seleção automática de produto, publicação de anúncio novo, processamento de pagamento ou chamada a endpoint inventado.
- A autorização segue `sales_channels.view` e `sales_channels.manage` já existentes no projeto; não foi adicionada uma nova regra de plano ou entitlement.

## Configuração de servidor

Cadastre apenas no ambiente Supabase autorizado; não use variáveis `VITE_*`:

- `MELI_CLIENT_ID`
- `MELI_CLIENT_SECRET`
- `MELI_REDIRECT_URI` exatamente `https://<project-ref>.supabase.co/functions/v1/mercadolivre-callback`, também registrada no Developer Center
- `MELI_TOKEN_ENCRYPTION_KEY`: chave aleatória de 32 bytes em Base64, exclusiva por ambiente
- `APP_ORIGIN`: origem HTTPS do Preview/ambiente autorizado para retornar após OAuth
- `MELI_PKCE_ENABLED`: opcional (`true`/`false`), deve refletir a configuração PKCE do aplicativo Mercado Livre; quando ativado, o verifier também é cifrado e consumido uma vez

Solicite no Developer Center somente permissões necessárias para leitura e escrita intencional; o fluxo precisa receber `refresh_token` para persistir a conexão. Nunca copie credenciais para o frontend, histórico do terminal ou logs.

## Publicação coordenada

1. Revisar e aplicar somente `20261015231925_mercado_livre_connector_foundation.sql` no projeto autorizado, depois de backup e autorização específica.
2. Configurar os secrets de servidor e a URL de callback no Developer Center.
3. Publicar apenas `mercadolivre-connect`, `mercadolivre-callback`, `mercadolivre-api` e `mercadolivre-webhook` com os modos JWT declarados em `supabase/config.toml`.
4. Publicar o frontend Preview correspondente e conectar uma conta de teste do Mercado Livre.
5. Validar conta de teste, refresh concorrente, consultas e notificações fictícias. Confirmar explicitamente antes de enviar qualquer preço/estoque de teste.

Até migration, secrets e funções serem publicados, o Preview deve mostrar o estado real “backend não publicado/configurado” quando a função não estiver disponível; não simula conexão.

## Referências oficiais

- [OAuth, state, scopes, troca de código e refresh token](https://developers.mercadolivre.com.br/pt_br/gerenciamento-perguntas-respostas/autenticacao-e-autorizacao)
- [Recomendações de armazenamento de credenciais](https://developers.mercadolivre.com.br/pt_br/publicacao-de-produtos/gestao-de-identidades-e-acessos-oauth-e-tokens)
- [Busca de itens do vendedor](https://developers.mercadolivre.com.br/pt_br/itens-e-buscas)
- [Pedidos e opiniões](https://developers.mercadolivre.com.br/pt_br/gerenciamento-de-vendas/pedidos-e-opinioes)
- [Notificações](https://developers.mercadolivre.com.br/produto-receba-notificacoes)
- [Atributos de itens](https://developers.mercadolivre.com.br/pt_br/atributos)
- [Atualização de publicações e estoque](https://developers.mercadolivre.com.br/pt_br/servico-sincronizacao-de-publicacoes)
