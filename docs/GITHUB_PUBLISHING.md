# Publicação segura pelo GitHub CLI

Use o fluxo de PR e os checks obrigatórios para publicar mudanças em `main`.

1. Verifique a autenticação local sem imprimir ou copiar tokens:

   ```powershell
   gh auth status
   ```

   Se `gh` não estiver no `PATH`, verifique a instalação oficial em `C:\Program Files\GitHub CLI\gh.exe` e invoque o executável por esse caminho. Não use `gh auth token`, não copie credenciais para argumentos ou arquivos e não altere os escopos sem autorização do titular.

2. Abra a PR a partir do branch publicado:

   ```powershell
   gh pr create --repo rafaelsilverios3/f7-pro-business --base main --head <branch> --title "<título>" --body-file <arquivo-de-descrição>
   ```

3. Aguarde e confira os checks:

   ```powershell
   gh pr checks <número> --repo rafaelsilverios3/f7-pro-business --watch
   gh pr view <número> --repo rafaelsilverios3/f7-pro-business --json mergeable,mergeStateStatus,reviewDecision,statusCheckRollup
   ```

4. Integre somente quando os checks obrigatórios passarem e a PR estiver `MERGEABLE`/`CLEAN`, sem ignorar proteção da branch:

   ```powershell
   gh pr merge <número> --repo rafaelsilverios3/f7-pro-business --merge
   ```

5. Atualize `main`, confirme o commit de merge e aguarde o deployment de produção correspondente ficar `READY`. Faça a verificação final em `https://f7business.com.br`.

Se a integração GitHub do agente retornar `403 Resource not accessible by integration`, não repita o mesmo pedido pela API: use somente uma sessão legítima já autenticada do `gh` ou peça ao proprietário para conceder o escopo oficial necessário. Nunca tente contornar as permissões ou a proteção de `main`.
