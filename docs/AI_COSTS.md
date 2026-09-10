# Controles de custo da IA

Os limites são configurados por empresa em `company_assistant_settings`: chamadas diárias, consultas web diárias, rodadas de pesquisa, tokens por requisição e custo diário. `reserve_ai_budget` serializa a reserva com advisory lock e registra consumo em `usage_counters` antes da chamada externa.

Pesquisa reserva um teto conservador de consultas. A chamada do modelo reserva uma chamada, os tokens estimados do contexto e o custo estimado. `estimated_cost_per_1k_tokens` começa em zero: enquanto a empresa não configurar uma taxa de referência, tokens e chamadas continuam limitados e o custo aparece como não configurado. Nenhum preço de provedor é inventado no código.

Ao atingir um limite, a execução termina com `AI_BUDGET_EXCEEDED`, mantém revisão humana e não chama o provedor correspondente.
