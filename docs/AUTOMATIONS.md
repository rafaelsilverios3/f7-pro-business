# Automações

Automações são regras empresa-específicas em `automations`. Cada execução é registrada em `automation_runs` com chave de idempotência para evitar duplicação. Na etapa atual a ação `create_notification` é interna e determinística; tarefas e integrações externas permanecem no fallback Base44.
