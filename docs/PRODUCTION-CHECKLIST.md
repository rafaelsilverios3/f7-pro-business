# Checklist de produção

- Aplicar migrations 0001 a 0011 no projeto Supabase e confirmar RLS/grants.
- Configurar apenas `VITE_DATA_PROVIDER`, `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY`; nunca publicar service role.
- Configurar URLs de redirect do Supabase Auth, confirmação de e-mail e recuperação de senha.
- Configurar domínio, HTTPS, backups e retenção do banco.
- Publicar Edge Functions de convite com secrets no Supabase.
- Verificar GitHub Actions, Node 22, logs de erro e health check.
- Testar isolamento entre empresas, usuários desativados, limites de plano e convites expirados.
- Monitorar RLS, falhas de automação e erros de rede antes dos primeiros clientes.
- Gateway de cobrança, WhatsApp e IA permanecem fora desta etapa.

## Hardening obrigatório

Antes do go-live, aplicar a 0012, validar as RPCs com usuários de cada role e configurar a Edge Function de convites. Não usar service role, tokens puros ou alteração de plano pelo navegador.

## Integrações externas

Antes de produção, aplicar a 0013, publicar as Edge Functions, configurar secrets no Supabase e validar o webhook Meta. O modo local sem credenciais retorna integração não configurada e não interrompe o ERP.
