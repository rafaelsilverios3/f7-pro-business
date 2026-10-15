# Controle financeiro de IA

## Contrato atual e mudança preparada

`0046_ai_observability_cost_health.sql` criou limites por empresa e a RPC legada `reserve_ai_budget`. A RPC antiga só compara o teto monetário quando `max_daily_ai_cost > 0`, contabiliza reservas agregadas sem chave idempotente e não liquida o gasto real. Esse comportamento não é seguro para autorizar geração paga.

A migration `20261014234651_ai_budget_reservations_and_settlement.sql` prepara o protocolo v2:

- `max_daily_ai_cost` deve ser positivo e acompanhado por `ai_budget_currency`; zero, ausência, `NaN`, moeda ausente ou inválida bloqueiam a reserva.
- `ai_rate_cards` identifica tipo de consumo, origem/provedor, modelo, versão, moeda, preço separado de entrada e saída (ou preço por consulta), vigência, referência pública, data de verificação e aprovador. Não há tarifas ativas sem aprovação. Termos de uma tarifa são imutáveis; mudanças exigem nova versão. Preços não finitos, incluindo `NaN`, são rejeitados.
- `ai_budget_reservations` registra empresa, chave idempotente, tarifa/versionamento, custo máximo e estado, sem prompts, conteúdo de conversas ou credenciais.
- `reserve_ai_budget_v2` serializa reservas da mesma empresa e dia com advisory lock, aplica simultaneamente os limites monetário, de chamadas, tokens e pesquisas, e grava ledger e contadores na mesma transação.
- Antes de iniciar o provedor, os chamadores também validam a resposta da RPC: exigem identificador UUID da reserva, tarifa/versionamento, moeda, custo positivo e limites reservados iguais ao pedido; uma resposta `allowed` incompleta ou inconsistente falha fechada.
- `settle_ai_budget_v2` liquida somente métricas confiáveis do provedor, atualiza custo e quantidade de tokens/consultas, permite registrar consumo acima da reserva e é idempotente. A diferença comprovadamente não consumida é liberada.
- Falhas, timeouts, ausência de métricas ou erro de liquidação deixam a reserva em `uncertain` (ou `reserved`) e mantêm o limite retido. Não existe reembolso automático.
- `mark_ai_budget_uncertain` só anota o motivo sanitizado e preserva a reserva.
- A assinatura legada de `reserve_ai_budget` passa a negar todas as novas reservas. Isso faz uma implantação mista falhar fechada: Edge Functions antigas não conseguem iniciar uma chamada paga sem o contrato novo.

O valor antigo `estimated_cost_per_1k_tokens` deixa de ser uma fonte de autorização. A decisão usa a tarifa exata para o `AI_API_URL` (origem HTTPS) e `AI_MODEL` efetivamente selecionados. Busca externa usa uma tarifa independente identificada pelo provedor ou origem configurada. Modelo/provedor sem tarifa ativa, única e compatível com a moeda do orçamento é bloqueado.

## Chamadores cobertos

As chamadas de geração do `ai-sales-assistant`, `assistant-suggest` e `intelligence-query` reservam entrada mais saída máxima antes do provedor, enviam `max_tokens`, passam uma chave de requisição e liquidam métricas informadas. `supplier-intelligence`, `assistant-suggest` e `intelligence-query` reservam o limite máximo de consultas que a pesquisa pode executar; cache comprovado pode liquidar zero. A busca externa continua submetida ao entitlement e limites funcionais preexistentes.

O pedido interno criado pelo `assistant-worker` mantém a chave estável do job; os serviços do frontend geram UUID para os demais pedidos. Repetir a mesma chave não volta a autorizar o provedor. Essa chave precisa ser reutilizada pela mesma tentativa de transporte para obter idempotência; uma ação nova do usuário recebe nova chave.

Autenticação, membership, papel, entitlement e permissões de ferramenta continuam sendo verificados pelos Edge Functions antes da reserva. As RPCs financeiras ficam executáveis apenas por `service_role`; as novas tabelas não têm acesso direto para papéis de API. O papel de serviço não substitui a identidade do usuário: ele é usado depois da autorização server-side já existente.

## Consistência, falhas e recuperação

Reserva, ledger e incremento de contadores são atômicos. Liquidação adquire o mesmo lock empresa/período, valida todos os invariantes antes de alterar contadores e registra a liquidação junto da reserva. Chaves repetidas, conflitos, liquidações repetidas e tentativas de outra empresa não autorizam gasto adicional.

A idempotência é por `(company_id, request_key)`: o mesmo ID e mesmos parâmetros não inicia uma segunda chamada; parâmetros divergentes com a mesma chave são rejeitados. Um novo ID é uma operação nova. Qualquer retry automático de transporte deve reutilizar o ID original; chamadas iniciadas deliberadamente pelo usuário geram IDs novos.

Uma reserva órfã permanece consumindo o limite do período. A recuperação é manual e baseada em comprovante de faturamento/uso do provedor: registrar métricas verificadas pela RPC de liquidação; se não houve cobrança, liquidar zero apenas após confirmação externa suficiente. Não apagar linhas nem reduzir contadores automaticamente. Se não for possível determinar o consumo, manter o bloqueio até o próximo período, preservando o registro para reconciliação.

O arquivo da migration abre e fecha uma transação explícita. No Supabase CLI 2.120.0, um teste local de falha injetada antes do `COMMIT` confirmou rollback integral: a coluna, as tabelas e o registro de histórico da migration não existiam após a falha. Um replay local da migration sobre o schema já criado também terminou sem erro. Essa prova cobre o runner local e PostgreSQL 17; não comprova o comportamento remoto do projeto gerenciado. Em erro remoto, interromper, consultar o histórico e inspecionar o schema antes de qualquer repetição, sem presumir rollback. Após aplicação, rollback operacional é **desativar chamadas pagas e manter a RPC legada fail-closed**, não restaurar o corpo vulnerável de 0046. Uma reversão estrutural requer procedimento revisado e compatibilidade de todas as Edge Functions; não se deve remover o ledger enquanto houver reservas abertas.

Os contadores históricos de `usage_counters` são preservados e ampliados de `integer` para `bigint`; a métrica monetária continua em microunidades, como em 0046. Antes de habilitar consumo, a homologação deve verificar os contadores do período atual e configurar explicitamente a moeda. Contadores históricos sem correspondência com tarifas específicas permanecem conservados de forma conservadora.

O ledger limita concorrência e reserva previamente o teto calculado, mas não consegue desfazer uma cobrança do provedor. Se o uso faturável reportado superar a reserva, a liquidação registra o valor real e bloqueia chamadas seguintes; a única chamada que excedeu pode ultrapassar o teto diário. A reserva de tokens usa bytes UTF-8 do contexto sanitizado como limite conservador e reserva toda a saída permitida, mas o limite ainda depende de o provedor respeitar `max_tokens` e reportar uso confiável. Portanto, isto reduz e detecta risco; não é garantia matemática de custo máximo por fatura. A ativação paga requer tarifa validada, margem de segurança aprovada, limites pequenos e monitoramento de over-reservation.

A identidade de tarifa de modelo é derivada da origem HTTPS e do nome de modelo configurados. Antes de tarifa real, confirmar que uma origem/modelo representa uma única identidade de cobrança e preço; endpoints/projetos distintos no mesmo host podem exigir uma chave de provedor mais específica. As tabelas não têm fluxo de administração de tarifas no produto: inserção/aprovação exige operação privilegiada, rastreada e revisada fora da interface normal.

## Impacto funcional

- **F7 AI Sales Assistant:** permanece com resposta factual quando geração paga não está pronta ou é negada; criação de rascunho continua pelo fluxo atual com confirmação humana.
- **F7 Intelligence:** mantém resumo determinístico/factual quando não há orçamento, tarifa ou métricas confiáveis. A pesquisa externa é omitida quando a reserva não pode ser feita.
- **Smart Atendimento (`assistant-suggest`):** sem orçamento/tarifa ou após negação de reserva, não chama o modelo e mantém o retorno de erro já previsto pelo fluxo assistido; não envia mensagem automaticamente. Essa experiência não é equivalente a uma resposta factual determinística.
- **Supplier Intelligence:** salvar manualmente um candidato não consome orçamento de busca; descoberta externa exige reserva por consulta antes da pesquisa.

Não são criadas compras, vendas, mensagens, alterações de preço, estoque ou lançamentos financeiros pelo protocolo.

## Estado de implantação

A migration e as mudanças nos chamadores estão preparadas apenas localmente. Não foram aplicadas em nenhum Supabase, não houve publicação de Edge Functions, ativação de `AI_ENABLED` ou chamadas pagas. Sem tarifas explicitamente aprovadas e sem configuração de moeda por empresa, geração paga permanece bloqueada por padrão.

Validação local em 12/10/2026: replay limpo de 89 migrations no Supabase local com PostgreSQL 17.11; 40 assertions pgTAP para orçamento inválido/zero, tarifas, idempotência, consumo acima da reserva, incerteza/reconciliação, isolamento e privilégios; teste concorrente com duas sessões obteve uma reserva aceita e a segunda negada pelo saldo; replay da migration sobre schema já criado passou; falha injetada antes do `COMMIT` via CLI deixou a coluna, as tabelas e a entrada do histórico ausentes; suíte geral com 655 testes, lint, typecheck normal/estrito e build passaram. `deno check` das quatro Edge Functions reportou 37 erros (38 linhas diagnósticas), com as mesmas ocorrências no baseline do HEAD; são problemas preexistentes de tipagem em outros pontos e não foram corrigidos neste escopo. A checagem completa do Deno não está verde.

Antes de futura implantação: revisar a migration e este contrato; obter aprovação separada para migration e funções; confirmar o destino e o estado remoto; obter backup lógico completo recuperável; congelar e drenar chamadas dos quatro endpoints antes da migration; aplicar migration primeiro; implantar todas as Edge Functions chamadoras compatíveis; verificar contadores, RPCs, privilégios e estado fail-closed; só depois considerar tarifa/orçamento autorizado. A migration barra novas reservas antigas depois do commit, mas não cancela uma execução Edge que já recebeu permissão da RPC antiga. Portanto, sem congelar/drain de tráfego antigo, não há prova de que nenhuma chamada paga atravesse a janela.

Após a migration, versões Edge antigas coexistindo com as novas são financeiramente fail-closed pela RPC legada, mas degradam funcionalidades até o rollout terminar: AI Sales Assistant continua em resposta factual; Smart Atendimento responde `AI_BUDGET_EXCEEDED` (429); F7 Intelligence usa resumo factual e sinaliza pesquisa externa indisponível; Supplier Intelligence responde `EXTERNAL_RESEARCH_BUDGET_UNAVAILABLE` (429). Atualizar funções antes da migration também falha fechado porque `reserve_ai_budget_v2` ainda não existe, mas não é uma alternativa sem freeze: as funções antigas ainda podem autorizar consumo pelo contrato anterior. Implantar funções uma a uma após a migration é aceitável somente com chamadas suspensas até todas passarem no pós-check.

No plano Free, a documentação atual do Supabase recomenda exports regulares com `supabase db dump` e armazenamento off-site; backups de banco não ficam disponíveis para download no Free. O backup prévio precisa incluir schema e dados de `public` (em especial `usage_counters` e `company_assistant_settings`), ser guardado fora do repositório, ter hash e ser restaurável em um ambiente descartável. Backup somente de schema não recupera contadores nem configurações. Verificar o plano e as opções exibidas no Dashboard no dia do rollout; não presumir que PITR esteja ativo.

## Risco residual

A reserva impede iniciar requisições cujo custo máximo calculado não cabe no orçamento. Se o provedor cobrar acima da tarifa informada, ignorar `max_tokens` ou reportar uso divergente, o excedente só é conhecido depois da resposta; o sistema o registra e bloqueia requisições seguintes, mas não consegue desfazer uma cobrança já ocorrida. Por isso a tarifa precisa ser conservadora e o limite de saída precisa ser respeitado pelo provedor. Timeout deixa o saldo retido até reconciliação. Testes locais não comprovam a tarifa, o comportamento de faturamento nem os privilégios do Supabase gerenciado.
