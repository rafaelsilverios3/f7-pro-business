# WhatsApp

O webhook recebe eventos Meta, encontra a integração pelo `external_phone_id`, cria/recupera conversa e grava mensagem com chave idempotente por empresa/canal. O envio permanece desativado até configurar a API Cloud e habilitar `WHATSAPP_ENABLED=true` no ambiente Edge.
