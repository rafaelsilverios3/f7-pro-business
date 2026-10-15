# Barreira reversível de manutenção para serviços de IA

Este documento descreve a implementação local da barreira `AI_MAINTENANCE_MODE`. Nenhuma configuração remota foi alterada nesta etapa.

## Comportamento

| Valor no segredo da Edge Function | Resultado nos endpoints de IA |
| --- | --- |
| Ausente ou vazio | Barreira inativa para preservar o comportamento atual. O rollout deve parar se não conseguir confirmar `true` antes de publicar a versão com o bloqueio. |
| `false` | Barreira inativa. |
| `true` | Novas operações autorizadas, inclusive `action=status` do AI Sales, recebem HTTP 503, código `AI_MAINTENANCE`, mensagem genérica e `Retry-After: 60`. |
| Qualquer outro valor | Falha fechada apenas nos endpoints de IA com HTTP 503 e código `AI_MAINTENANCE_CONFIGURATION_INVALID`. |

O preflight `OPTIONS` continua respondendo antes da barreira. As funções preservam autenticação, membership, entitlement e permissões antes de informar manutenção. A resposta não inclui empresa, dados comerciais, configuração ou credenciais. A barreira é verificada uma vez por requisição: chamadas que já passaram do ponto de controle podem terminar; chamadas que ainda não passaram não iniciam leitura comercial, reserva ou acesso a provedores.

A barreira afeta somente os endpoints de IA tratados. Não bloqueia o restante do F7 Business. No AI Sales, `status` é bloqueado depois de autenticação, membership e entitlement, antes do contador de status e da leitura de configurações da empresa; `chat`/`create_draft` são bloqueados depois da autorização específica da ferramenta. As demais funções mantêm seus gates após a autenticação/autorização necessária para identificar o tenant. O preflight CORS continua respondendo antes da barreira. Fora da manutenção, o fallback factual e o caminho determinístico existentes permanecem inalterados.

## Estado final de `ai_runs` no AI Sales Assistant

- `completed`: resposta entregue, inclusive resposta factual após timeout/indisponibilidade do provedor, ou rascunho criado pela RPC depois da confirmação explícita.
- `handed_off` com `CONFIRMATION_REQUIRED`: sugestão de rascunho concluída, aguardando ação humana; nenhum pedido é criado por essa resposta. Uma requisição direta de criação sem `confirmed=true` é registrada nessa condição e devolve HTTP 409.
- `failed`: erro controlado ou cancelamento de requisição observado pelo runtime. Timeout do provedor que resulta em fallback factual não é classificado como falha da resposta entregue; o código seguro do timeout fica registrado.
- `running`: execução iniciada que ainda não chegou a uma finalização observável. Se o runtime for encerrado abruptamente antes de executar o finalizador, o status pode permanecer assim; não se inventa estado terminal nem se reconciliam os 32 registros antigos nesta alteração.

Os campos persistidos são allowlisted conforme o schema de `ai_runs`; `tool_count`, que não existe na tabela, é descartado. Erros retornados pelo PostgREST e exceções ao gravar `ai_runs`/`ai_run_events` emitem diagnóstico contendo apenas operação e código estável, nunca mensagem bruta, prompt, token ou ID de empresa.

## Canais de invocação encontrados no repositório

- O frontend chama diretamente `ai-sales-assistant`, `assistant-suggest`, `intelligence-query` e `supplier-intelligence` por `functions.invoke`.
- `whatsapp-webhook` envia jobs para `assistant-worker`, que chama `assistant-suggest` com autenticação interna.
- Não foi encontrado `pg_cron`, `net.http_post` ou agendamento no repositório chamando diretamente esses quatro endpoints. Isso não prova ausência de integrações externas configuradas fora do repositório.
- `assistant-worker` também verifica manutenção antes de reivindicar jobs. Se uma chamada interna que já reivindicou um job encontrar a barreira ao chegar a `assistant-suggest`, o worker devolve o job à fila e marca o evento como pendente, sem convertê-lo em erro terminal.

## Publicação antes da migration 0089

O inventário remoto somente de leitura de 2026-10-13 retornou `ai-sales-assistant` ativa na versão 13 e `invite-user` ativa na versão 2. Não retornou `assistant-worker`, `assistant-suggest`, `intelligence-query` ou `supplier-intelligence`; portanto, no inventário observado, não há `assistant-worker` remoto para drenar ou proteger. A listagem precisa ser repetida no momento do rollout. A v13 não conhece a variável de manutenção; somente cadastrar o segredo não a interrompe.

Sequência proposta para uma futura janela autorizada:

1. Confirmar o nome/ref do projeto, a branch/commit do Preview e o estado remoto de migrations/funções. Como a v13 ignora `AI_MAINTENANCE_MODE`, verificar pelo Dashboard se a geração antiga está desligada (`AI_ENABLED` ausente/false) e mantê-la assim até a nova versão estar ativa. Se não for possível comprovar esse estado, desabilitar a geração como etapa separada explicitamente autorizada antes do deploy protegido. Também confirmar que `AI_MAINTENANCE_MODE` está exatamente `true`, sem exibir valores de segredos. Se alguma condição não puder ser verificada, parar.
2. Conferir no Dashboard se `assistant-worker` ou algum dos outros três endpoints está implantado apesar do inventário anterior. Não presumir que a configuração não divergiu.
3. Publicar primeiro a versão de `ai-sales-assistant` com a barreira, ainda mantendo a migration 0089 pendente. Com a flag `true`, o código faz autenticação, valida membership/entitlement/permissão e retorna antes de iniciar `ai_runs`, acessar catálogo, reservar orçamento v2 ou chamar provedor. Assim, ele não depende da RPC v2 ausente antes da migration.
4. Se `assistant-worker` estiver ativo, publicar também a barreira do worker antes de migrar, para impedir que novos jobs sejam reivindicados. Se `assistant-suggest` estiver ativo, sua versão protegida deve ser publicada antes de migrar. Um endpoint atualmente inexistente não pode ter tráfego executável, mas confirmar isso no Dashboard é precondição.
5. Manter a barreira ativa e drenar requisições que já atravessaram o gate. A evidência deve vir dos logs de invocação do Supabase por função (horário, status, duração), não dos 32 `ai_runs` antigos: eles são registros históricos obsoletos e não serão alterados. Aguardar pelo limite máximo de execução configurado para o projeto após a última chamada que passou pelo gate e confirmar que não há novas invocações além das respostas 503 de manutenção. Se não houver visibilidade suficiente para distinguir chamadas ativas, parar.
6. Com backup e preflight aprovados em autorização própria, aplicar 0089 uma vez. Verificar o histórico e as RPCs sem desativar a barreira.
7. Publicar os endpoints compatíveis com v2, mantendo `AI_MAINTENANCE_MODE=true`; verificar a identidade/configuração do projeto e respostas de manutenção sem fazer chamadas pagas.
8. Só desativar a barreira em uma etapa posterior explicitamente autorizada, depois de verificar os controles de orçamento, a ausência de ativação não aprovada de provedores e os critérios de smoke test. `false` é reversível; a remoção do segredo equivale a inativo e deve ser evitada como mecanismo de rollback operacional.

O deploy não encerra chamadas já em andamento na versão antiga. A janela de drenagem é obrigatória. A duração limite de execução depende do plano e da configuração Supabase do projeto, que precisam ser confirmados no momento do rollout.

## Compatibilidade com a v13 e limitações

- O caminho de bloqueio da nova versão ocorre antes das RPCs v2, da reserva de orçamento, da leitura comercial e da chamada ao provedor. Imports de helpers v2 são declarações sem I/O ou RPC no nível do módulo. A versão completa pode, portanto, substituir v13 antes de 0089 se `AI_MAINTENANCE_MODE=true` estiver confirmado e a barreira estiver habilitada na nova versão. A ausência da variável mantém o modo operacional por compatibilidade; nesse caso, geração paga continua fechada antes de 0089 porque a RPC de reserva v2 não existe e erros de reserva resultam em fallback factual, sem chamar o provedor. Após 0089, o mesmo código operacional pode reservar consumo somente se tarifa e orçamento válidos autorizarem.
- A 0089 também cria `company_assistant_settings.ai_budget_currency`. No schema anterior, a leitura de status trata o erro dessa coluna como orçamento indisponível e informa `factual_only`; no chat, a leitura de configuração falha fechada e mantém `factual_fallback`, sem tentar a reserva v2 nem chamar o provedor. A migration é transacional, então coluna e RPC devem aparecer juntas; se uma implantação parcial for observada, manter a manutenção e interromper o rollout.
- O endpoint `status` também retorna 503 durante manutenção, sem consumir limite nem consultar `company_assistant_settings`; CORS, Auth, membership e entitlement permanecem na frente da resposta.
- A v13 já implantada ignora a flag até ser substituída. Não há como ativar a barreira nela retroativamente sem publicar código.
- O controle não interrompe uma chamada externa que já começou depois de passar pelo gate; o procedimento precisa bloquear novas entradas e esperar o encerramento natural das chamadas anteriores.
- Uma interrupção abrupta do runtime pode impedir a finalização de `ai_runs`. A função não inventa estado terminal nesses casos; o registro pode continuar `running` e requer reconciliação futura separada. Os 32 registros existentes não são atualizados por esta alteração.
- A barreira em `assistant-worker` foi incluída para preservar jobs ainda não iniciados. Chamadas HTTP externas fora do repositório continuam cobertas no endpoint destino, mas sua existência só pode ser verificada nos controles/logs remotos.

## Evidência local da versão intermediária (2026-10-14)

Validação executada sem escrever no Supabase remoto, sem chamada a provedor e sem credenciais reais:

- Supabase CLI 2.120.0 serviu os arquivos no Supabase Edge Runtime 1.77.4 (compatível com Deno 2.1.4). Os handlers de `ai-sales-assistant`, `assistant-worker`, `assistant-suggest`, `intelligence-query` e `supplier-intelligence` foram importados e responderam ao preflight CORS.
- Em runtime com flag `true`, `ai-sales-assistant` (`chat` e `status`), `assistant-suggest`, `intelligence-query` e `supplier-intelligence` responderam 503 `AI_MAINTENANCE`. O mock de Auth/PostgREST confirmou a ordem de validação de usuário, membership e entitlement. Não houve rate-limit, leitura comercial, reserva, leitura de settings ou chamada externa. `assistant-suggest` registrou somente eventos sanitizados de progresso da etapa de autorização antes do gate.
- Com flag inválida, `ai-sales-assistant` respondeu 503 `AI_MAINTENANCE_CONFIGURATION_INVALID`; com `false`, o fluxo permaneceu habilitado. Com flag ausente e provedor desligado, o status factual retornou 200 `factual_only` e chat retornou 200 `factual_fallback`.
- Em um mock do contrato de schema anterior à 0089, a coluna `ai_budget_currency` estava ausente: status retornou `factual_only` e chat `factual_fallback`, sem chamada a RPC v2. Em um mock do contrato posterior à 0089, a reserva v2 respondeu negação por tarifa indisponível: status reportou `provider_configured_unverified` (sem afirmar conexão ativa) e chat permaneceu em `factual_fallback`; não houve chamada ao provedor.
- O teste pós-0089 acima simula as respostas da Data API/RPC; não substitui validação SQL em um PostgreSQL que tenha aplicado a migration. Nenhuma chamada foi roteada para um serviço de IA: o endpoint de teste era reservado sob `.invalid` e a reserva simulada nunca autorizou geração.
- A listagem remota somente de leitura no projeto autorizado retornou 88 migrations até `20261012150226_supplier_offers_foundation`. Ela listou `ai-sales-assistant` ativa na v13 e `invite-user` v2; não listou `assistant-worker`, `assistant-suggest`, `intelligence-query` nem `supplier-intelligence`. O inventário deve ser atualizado novamente no momento da implantação.

Estas provas demonstram importação e caminhos do handler em Edge Runtime local com Auth/PostgREST simulados; não provam autenticação real, configuração atual dos segredos, estado de tráfego ou implantação remota.

## Reversão

Durante manutenção, a reversão operacional é definir `AI_MAINTENANCE_MODE=false` somente se o código/migration estiver em estado compatível e houver autorização para reabrir as rotas. Se o deploy protegido falhar antes da migration, manter a versão segura/barreira ativa; não retornar automaticamente à v13, pois a v13 não lê a flag. Reverter código depois da 0089 exige primeiro validar compatibilidade do código antigo com as novas RPCs e políticas; não fazer rollback automático.
