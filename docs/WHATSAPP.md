# WhatsApp

O webhook recebe eventos Meta, encontra a integração pelo `external_phone_id`, cria/recupera conversa e grava mensagem com chave idempotente por empresa/canal. O envio permanece desativado até configurar a API Cloud e habilitar `WHATSAPP_ENABLED=true` no ambiente Edge.

## Preparação de ativação

O webhook e o envio permanecem desligados. Para ativar, publique as functions, configure secrets server-side e passe pelos testes de assinatura, ownership de conversa, plano e deduplicação.
