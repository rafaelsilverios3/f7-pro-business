# F7 PRO Business: consolidação para a nova produção

Escopo desta preparação: manter a candidata Supabase `vwylnjmapixtzhryiutt` como futura produção, sem alterar o projeto antigo `izakmtgezocbneilopwr`, sem trocar domínio/deploy, sem alterar secrets e sem ativar operações externas.

## Edge Functions exclusivas do projeto antigo

| Função | Uso encontrado | Decisão para a candidata | Gate antes de publicar |
| --- | --- | --- | --- |
| `automation-scheduler` | Dispara automações agendadas e recuperação da fila Mercado Livre | Preservada no repositório; agora retorna `disabled` sem executar consultas ou tarefas até os três flags explícitos | Publicar somente após validar autenticação interna e configurar agenda sem executar ações antes do corte |
| `automation-worker` | Executa regras e cria notificações internas; ações transacionais continuam bloqueadas | Preservada no repositório; `verify_jwt=true` explícito, além da autorização por vínculo/empresa já exigida pelo código | Publicar com migration 0063 e objetos de automação existentes; sem habilitar jobs na promoção |
| `ai-run-inspector` | Mostra traces sanitizados ao admin/gestor da empresa | Preservada; valida UUID, vínculo ativo e diferencia erro de consulta de falta de papel | Publicar com JWT; leitura da empresa somente |
| `platform-health` | Exibe saúde operacional baseada em evidências recentes | Preservada; valida vínculo ativo, erro de persistência não é apresentado como sucesso | Publicar com JWT; nenhuma sondagem paga/externa é feita |
| `billing-plans` | Compatibilidade de leitura do catálogo público | Mantida como endpoint público somente de leitura; o frontend atual carrega o catálogo diretamente das tabelas `plans` e `plan_features` | Publicar apenas se consumidores externos/legados ainda o usarem; campos limitados ao catálogo público |

As fontes locais existem para as cinco funções; a lista remota da candidata não as continha. Nenhuma versão antiga foi copiada por cima das Edge Functions novas. A lista remota de homologação contém versões mais recentes das funções principais de AI Sales, Billing, WhatsApp, Administração e Mercado Livre; a candidata mantém essas versões e seus gates JWT atuais.

## Agendamento e filas

O projeto antigo possuía `pg_cron`/`pg_net` e uma agenda de automação a cada cinco minutos. A candidata não tinha essas extensões e não tinha jobs registrados. A implementação existente reutiliza `automation-scheduler` para recuperar a fila Mercado Livre, enquanto o webhook continua fazendo um despacho oportunista após persistir o evento.

O scheduler agora exige autenticação interna **e** `F7_SCHEDULER_ENABLED=true`. Trabalho de automações e recuperação Mercado Livre têm flags independentes (`F7_AUTOMATION_SCHEDULER_ENABLED` e `F7_MELI_QUEUE_RECOVERY_ENABLED`), ambos desligados por padrão e subordinados ao master. O worker Mercado Livre também exige `F7_MELI_QUEUE_PROCESSING_ENABLED=true`, inclusive quando acordado diretamente pelo webhook; sem ele, o evento continua persistido e não consulta a API. Nenhum desses flags foi configurado. Não existe agenda ativa preparada nesta candidata; a habilitação deve acontecer na janela do corte, depois de conferir o destino e os segredos no Vault. A agenda antiga não é reutilizada automaticamente.

Preparação local do agendamento (não executada): habilitar `pg_cron`, `pg_net` e Vault no Dashboard depois do corte; salvar no Vault uma chave pública da candidata e um segredo dedicado e novo do scheduler; cadastrar o mesmo segredo novo como Edge Secret `F7_SCHEDULER_SECRET`; publicar `automation-scheduler` com JWT gateway desligado, mantendo a validação do segredo no handler. A agenda de cinco minutos pode então fazer apenas POST interno ao scheduler, com URL fixa da candidata e cabeçalho secreto obtido do Vault. O handler retorna `SCHEDULER_DISABLED` até o master flag ser explicitamente ativado. A forma oficial de chamar uma Edge Function agendada usa `pg_cron`, `pg_net` e Vault ([Supabase docs](https://supabase.com/docs/guides/functions/schedule-functions)); esse padrão será usado somente após a janela de corte.

## Configuração, sem copiar valores

`presentes` e `ausentes` abaixo descrevem o inventário anterior de nomes de secrets e configuração; nenhum valor foi lido ou reproduzido nesta preparação. A candidata não oferece um inventário de valor recuperável por hash. Valores de credenciais devem ser conferidos no gerenciador/provedor original e cadastrados no projeto novo por um operador autorizado.

| Serviço/configuração | Produção antiga | Candidata | Ação para o corte |
| --- | --- | --- | --- |
| URL, publishable/anon key e service role Supabase | específicos do projeto antigo | específicos da candidata | Nunca copiar chaves internas; configurar Vercel Production para a URL/chave pública da candidata e manter a service role apenas em Edge Secrets |
| `APP_ORIGIN`, `APP_URL` | existentes | existentes para o domínio oficial | Revalidar domínio e redirects na janela do corte; valores não são tokens |
| WhatsApp (`WHATSAPP_ENABLED`, verify token, app secret, access token) | configurados no projeto antigo | ausentes | Recriar/revogar no Meta e cadastrar apenas após aprovação de envio/webhook; atualizar URL de webhook só no corte |
| IA (`AI_ENABLED`, `AI_API_KEY`, `AI_API_URL`, `AI_MODEL`) | configurados no projeto antigo | credenciais/modelo ausentes; manutenção factual existente | Não copiar chave/hash; usar credencial nova do provedor e manter `AI_ENABLED` desligado até aprovação e piloto de orçamento |
| Busca web (`WEB_SEARCH_PROVIDER`, `WEB_SEARCH_API_URL`, `WEB_SEARCH_API_KEY`) | configurados no projeto antigo | ausentes | Recriar no serviço de busca; configurar somente após limites/preço por consulta e autorização |
| Mercado Pago (`MERCADO_PAGO_ACCESS_TOKEN`, `MERCADO_PAGO_WEBHOOK_SECRET`, `MERCADO_PAGO_ENVIRONMENT`, `MERCADO_PAGO_PRODUCTION_PAYMENTS_ENABLED`) | nomes presentes no projeto antigo | ausentes | Gerar credenciais próprias da nova integração no painel Mercado Pago; iniciar em sandbox; pagamentos de produção permanecem bloqueados |
| Mercado Livre (`MELI_CLIENT_ID`, `MELI_CLIENT_SECRET`, `MELI_REDIRECT_URI`, `MELI_TOKEN_ENCRYPTION_KEY`) | valores de produção antigos existem, não recuperáveis por hash | app DEV configurado na candidata | Criar app de produção separado; não copiar credenciais DEV nem assumir que segredo antigo é válido; cadastrar callback oficial da candidata; não trocar webhook antes do corte |
| Google OAuth | habilitado no Supabase antigo | desabilitado na candidata | Recriar OAuth client autorizado para domínio/callback novo e habilitar no Auth Dashboard |
| SMTP transacional | SMTP customizado desabilitado no antigo | SMTP customizado desabilitado na candidata | Configurar provedor, domínio remetente e DNS; validar confirmação, convite e reset antes do corte |
| Storage | mesmos três buckets/policies; antigo possui objetos e candidata não | estrutura e policies presentes, sem objetos migrados | Rever branding/catálogo e migrar somente ativos necessários com aprovação própria; não copiar objetos sem necessidade |
| `F7_SCHEDULER_SECRET` e flags | secret antigo; agenda antiga ativa | secret/flags ausentes | Gerar segredo novo no gerenciador autorizado e guardar também em Vault para cron; nunca reutilizar service role como segredo dedicado |
| Domínio/redirects Auth | `f7business.com.br` no app antigo | allowlist já inclui domínio oficial | Incluir URLs específicas de produção e redirect de callback do Supabase; testar e-mail/OAuth em conta de teste |

Configuração de runtime reservada a cada projeto — chaves Supabase, URL, JWT signing keys, encryption key própria do Auth — não deve ser transferida. Secrets legados cujo valor só exista como hash não são recuperáveis; rotacionar/recriar no provedor é a única opção segura.

## Identidade owner

A conta Auth `rafaelsilverio.s3@gmail.com` existe na candidata, UUID `afb40240-2a34-42eb-982c-1d4dc30011a2`. A consulta somente de leitura não encontrou linha correspondente em `public.platform_admins`; portanto essa identidade **ainda não tem papel global owner na candidata**. Nenhuma alteração privilegiada foi executada. A conta operacional administrativa existente é independente e não substitui o owner designado.

Para preservar a propriedade global, o owner deve ser provisionado pelo procedimento de administração global versionado e auditado, em uma operação de bootstrap inicial no novo projeto, com confirmação de identidade e trilha de auditoria. Exige autorização específica para a escrita privilegiada; não se deve conceder `owner` ao usuário operacional.

## Isolamento de Preview

O Vercel tinha placeholders inertes de Supabase no ambiente Preview e a configuração de produção ainda apontava para o Supabase antigo. Esta preparação acrescenta uma falha fechada no build para impedir Preview de apontar aos dois projetos protegidos. Isso não altera variáveis Vercel nem remove credenciais de deploys já existentes; deployments antigos são imutáveis e precisam ser mantidos desativados/retirados do tráfego por configuração Vercel autorizada. Não declarar isolamento completo até confirmar os valores Preview atuais e eliminar/reconfigurar deployments legados.

## Sequência operacional posterior

1. Aprovar/provisionar owner na candidata e validar login e autorização.
2. Configurar de novo Google OAuth e SMTP, depois testar Auth, e-mail e callback.
3. Fazer deploy coordenado das funções faltantes com os valores de `verify_jwt` do `supabase/config.toml` e configurar apenas secrets autorizados.
4. Manter scheduler flags desligados; aplicar extensões/agenda somente na janela aprovada do corte e iniciar com `F7_SCHEDULER_ENABLED=false` até validar endpoints.
5. Trocar variáveis Vercel Production para URL/chave pública da candidata, testar o domínio oficial e manter o Supabase antigo sem alterações como contingência.
6. Ativar integrações externas uma a uma, começando por sandbox; só trocar URLs de webhook após validar os handlers e obter autorização para eventos reais.
