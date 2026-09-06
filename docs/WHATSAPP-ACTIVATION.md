# WhatsApp Activation

1. Aplicar migrations 0013, 0014 e 0015.
2. Configurar Supabase Secrets: `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_APP_SECRET`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_GRAPH_VERSION`, `APP_URL`, `APP_ORIGIN`.
3. Manter `WHATSAPP_ENABLED=false` durante deploy e executar os testes de assinatura.
4. Publicar `whatsapp-webhook`, `whatsapp-send`, `whatsapp-connect`, `whatsapp-disconnect` e `integration-health`.
5. No Meta App, configurar callback `https://<PROJECT_REF>.supabase.co/functions/v1/whatsapp-webhook` e o verify token.
6. Confirmar Phone Number ID, WABA ID e permissões da Graph API.
7. Testar inbound, outbound, status, duplicidade e isolamento multiempresa.
8. Só então habilitar `WHATSAPP_ENABLED=true`.

O access token nunca é enviado pelo frontend ou salvo em `company_integrations`.

## Deploy

```bash
supabase functions deploy invite-user
supabase functions deploy whatsapp-webhook
supabase functions deploy whatsapp-send
supabase functions deploy whatsapp-connect
supabase functions deploy whatsapp-disconnect
supabase functions deploy integration-health
```

Execute primeiro com `WHATSAPP_ENABLED=false`, valide assinatura, health, inbound, outbound e duplicidade, e só depois habilite o tráfego.
