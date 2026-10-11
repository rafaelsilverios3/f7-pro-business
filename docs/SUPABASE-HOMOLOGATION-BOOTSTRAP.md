# Supabase de homologação — bootstrap controlado

## Escopo e segurança

Este procedimento prepara um banco Supabase local descartável e descreve, sem executar, a futura instalação no projeto remoto `f7-pro-business-homolog`. Nenhum comando remoto foi executado. Não use credenciais de produção neste procedimento.

O arquivo `supabase/config.toml` deste repositório ainda contém `project_id = "f7-pro-business"`. Para teste local, use uma cópia isolada do diretório `supabase` e troque o identificador para `f7-pro-business-homolog-local`. Para um futuro comando remoto, use somente o project ref copiado do Dashboard do projeto de homologação e passe-o explicitamente ao Supabase CLI; confirme o nome e o ref antes de qualquer aplicação.

## Ferramentas verificadas

- Supabase CLI `2.120.0`, executado com `npx` (não instalado globalmente).
- Docker Engine `29.7.2`, ativo.
- Container local de PostgreSQL da aplicação já ocupava a porta `5432`; o Supabase local usou a porta `54322`, sem interromper aquele container.
- A imagem local foi Supabase Postgres `15.19.0.004`, compatível com `db.major_version = 15`.
- `psql` não está instalado no host; consultas de verificação foram feitas com o cliente dentro do container local do Supabase.

## Procedimento local reproduzido

1. Copiar `supabase/migrations` e, se for validar os bundles, `supabase/functions` para um diretório temporário fora do checkout.
2. Na cópia, definir `project_id = "f7-pro-business-homolog-local"` e acrescentar:

   ```toml
   [db.seed]
   enabled = false
   ```

3. Iniciar e reconstruir somente o banco local:

   ```powershell
   npx --yes supabase@2.120.0 start
   npx --yes supabase@2.120.0 db reset --local --no-seed
   npx --yes supabase@2.120.0 migration list --local
   ```

4. Verificar que a lista local não tem pendências. O diretório contém 83 arquivos de migration válidos, numerados de `0001` a `0084`; não existe arquivo `0022`, e a lacuna não deve ser preenchida artificialmente.
5. Interromper o ambiente quando não estiver em uso:

   ```powershell
   npx --yes supabase@2.120.0 stop
   ```

O `seed.sql` atual **não foi executado**. Ele depende de um UUID de empresa fixo, não cria usuários Auth nem membership e não é um bootstrap seguro/reprodutível para esse fluxo.

## Resultado do teste local

As 83 migrations existentes foram aplicadas em ordem num banco local vazio, duas vezes, com `--no-seed`; a segunda passagem foi um reset explícito do banco local. A primeira tentativa revelou um erro real em `0036_company_feature_overrides.sql`: a RPC `company_has_feature(uuid,text)` existente recebe o argumento nomeado `feature`, mas a migration tentava renomeá-lo para `target_feature` com `CREATE OR REPLACE`, o que PostgreSQL rejeita. A migration foi corrigida para preservar o parâmetro `feature` e qualificar a coluna da tabela com alias. Isso preserva a assinatura usada pelas chamadas PostgREST e o comportamento da regra.

A correção altera apenas o arquivo histórico para que um bootstrap vazio possa aplicá-lo. Em um banco que já registrou a versão `0036`, o Supabase CLI não reaplica esse arquivo: a função e os dados existentes permanecem como estão. Assim, a mudança não substitui uma definição já instalada nem corrige retroativamente uma instalação divergente; qualquer estado divergente deve ser inspecionado e tratado em uma migration nova, após revisão própria.

Inventário após bootstrap limpo:

- 83 versões na tabela `supabase_migrations.schema_migrations`, de `0001` a `0084` (com a lacuna `0022`).
- 89 tabelas públicas, 61 funções, 30 triggers e 151 policies públicas.
- Nenhuma tabela pública com coluna `company_id` foi encontrada sem RLS habilitado.
- O trigger `auth.users → profiles` foi criado.
- Os três buckets existem: `company-branding` e `product-catalog` são públicos conforme as migrations de loja; `whatsapp-media` é privado. Foram criadas 11 policies em `storage.objects`.
- As RPCs `create_company_with_owner`, `current_company_role`, `company_has_feature`, `import_commercial_campaign_atomic` e `resume_commercial_campaign_import_atomic` existem. Nos grants verificados, `anon` não pode executá-las e os papéis `authenticated`/`service_role` têm os grants previstos; as RPCs comerciais também validam role dentro do corpo.

Fixtures criadas apenas no banco local: três usuários Auth fictícios, duas empresas fictícias, dois administradores, um membro `vendedor`, um produto por empresa e uma campanha sintética em uma empresa. O teste confirmou que cada tenant vê somente seu produto, que os papéis retornados são distintos, que a RPC nomeada `company_has_feature` aceita o argumento `feature`, que o vendedor não consegue importar campanha, e que a importação aprovada cria fato/alvo e uma repetição do mesmo hash é idempotente. Senhas e tokens foram gerados somente em memória para o teste; não foram gravados no repositório.

## Etapas futuras para o projeto remoto de homologação

**Estas etapas não foram executadas e exigem autorização própria antes de qualquer escrita remota.**

### Antes de vincular ou aplicar migrations

1. No Dashboard, confirmar por fonte independente o nome `f7-pro-business-homolog`, o project ref, a região e a versão PostgreSQL. Na verificação somente de leitura desta etapa, o nome/ref conferidos foram `f7-pro-business-homolog` / `vwylnjmapixtzhryiutt`, a região `us-east-1` e o PostgreSQL remoto `17.11.0.003`. O painel também mostra a branch `main PRODUCTION`; o nome e ref atuais correspondem ao projeto homolog solicitado, mas devem ser reconferidos antes de qualquer comando remoto.
2. A leitura do schema `public` mostrou zero tabelas, e a página Migrations mostrou “Run your first migration”; não há histórico de migrations exibido. A lista Auth mostrou o estado “No users”, mas também um total estimado de 10 usuários. Essa inconsistência impede certificar que Auth esteja vazio; resolva-a antes de instalação ou testes com dados.
3. A configuração consultada mostrou Auth `2.197.0`, PostgREST `14.18` e PostgreSQL `17.11.0.003`. O bootstrap local validado nesta etapa usou PostgreSQL `15.19.0.004` (configuração `db.major_version = 15`), portanto a compatibilidade do bootstrap com o major remoto 17 não foi comprovada. Reproduza o reset limpo local com PostgreSQL major 17 antes de considerar o destino pronto para instalação.
4. A tela de Database Settings não exibiu o estado SSL em leitura, e a página de URLs/Auth não exibiu os valores de Site URL/redirect allowlist. A revisão desses ajustes permanece pendente; não inferir configuração a partir dos campos não carregados.
5. Confirmar que nenhuma sessão/comando Supabase está vinculada ao projeto de produção. Não incluir `SUPABASE_ACCESS_TOKEN`, database password ou chave `service_role` em comandos salvos, arquivos, logs ou variáveis `VITE_*`.
6. Revisar no Dashboard os serviços padrão Auth e Storage e os papéis `anon`, `authenticated` e `service_role`. Não desabilitar RLS nem reduzir grants para acomodar migrations.
7. Fazer backup do estado inicial mesmo que o projeto pareça vazio; guardar o backup fora do Git e de produção.

### Aplicação remota, depois da autorização

Use um checkout de homologação dedicado e confirme o alvo explicitamente:

```powershell
$projectRef = Read-Host 'Cole o project ref copiado do Dashboard de f7-pro-business-homolog'
$confirmRef = Read-Host 'Digite novamente o project ref para confirmar o destino'
if ($projectRef -ne $confirmRef -or [string]::IsNullOrWhiteSpace($projectRef)) { throw 'Project ref não confirmado; nenhuma migration deve ser aplicada.' }
npx --yes supabase@2.120.0 link --project-ref $projectRef
npx --yes supabase@2.120.0 migration list --linked
npx --yes supabase@2.120.0 db push --linked --dry-run
```

**PARE após o `--dry-run`: não execute SQL nem continue automaticamente.** Registre o project ref e o plano apresentado, confirme que o alvo é o projeto homolog, que não há versões remotas desconhecidas e que o plano lista exatamente as migrations locais esperadas. Uma divergência, qualquer migration já registrada ou qualquer dado/schema encontrado exige revisão. Não prossiga enquanto o Auth não for verificado como vazio, o estado das URLs/SSL não estiver confirmado e o bootstrap local não tiver sido validado em PostgreSQL major 17. Solicite autorização explícita separada para a aplicação remota; somente em uma etapa posterior autorizada, aplique sem `--include-all` e sem `--yes`, para manter a confirmação interativa do CLI:

```powershell
npx --yes supabase@2.120.0 db push --linked
```

Depois, repita `migration list --linked`, confirme zero migrations pendentes e execute no Dashboard as verificações de catálogo/RLS/grants/buckets descritas acima. Não use `db reset` no remoto.

### Dados fictícios e smoke tests remotos

1. Criar três usuários de teste no Auth do projeto de homolog: administrador da Empresa A, vendedor da Empresa A e administrador da Empresa B. Usar e-mails reservados de teste e senhas definidas pelos próprios testadores; nunca registrar senhas no Git ou em relatório.
2. Fazer login de cada administrador pelo app apontado exclusivamente ao projeto homolog e criar uma empresa pelo onboarding. Adicionar o vendedor A pelo fluxo autorizado de convite/membros. Não inserir registros diretamente em `auth.users`.
3. Criar em cada empresa um cliente e produto fictícios com identificadores diferentes. Criar/importar uma campanha representativa somente após validar que o app e o Preview apontam ao projeto homolog.
4. Confirmar isolamento A/B com cada usuário, permissões Admin/Vendedor, acesso à rota F7 Commerce, role após troca de empresa, autenticação e retorno à rota protegida.
5. Validar leitura pública intencional de imagens em `product-catalog` e `company-branding`; não colocar dados privados nesses buckets. Testar `whatsapp-media` como privado e limitado por membership.
6. Confirmar que nenhuma credencial de produção ou cliente real foi reutilizada. Desabilitar/excluir usuários e fixtures descartáveis no fim, conforme política aprovada.

## Vercel Preview — plano separado, não executado

Quando autorizado, definir somente no escopo **Preview** `VITE_DATA_PROVIDER=supabase`, `VITE_SUPABASE_URL` e a chave pública `anon`/publishable do projeto homolog. Não alterar o escopo Production. Comparar os valores de Preview e Production antes/salvar, configurar no Auth de homolog a URL base e allowlist de redirects do domínio Preview, e verificar a URL do projeto embutida no bundle Preview antes de autenticar ou gravar. Nenhuma variável de Vercel foi alterada nesta etapa.

Para login/Commerce básicos, não é necessário configurar secrets de IA, WhatsApp ou pagamentos. Funções de integração devem permanecer sem conexão externa até a homologação específica desses provedores. Quando forem necessárias, configurar secrets apenas nas Edge Functions do projeto homolog.

