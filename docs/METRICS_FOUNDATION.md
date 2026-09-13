# Fundação de métricas

As métricas compartilhadas recebem sempre `company_id` e um `periodContext`:

```js
{ company_id, start_date, end_date, timezone, period_key }
```

`createPeriodContext` suporta `today`, `7d`, `30d`, `month`, `quarter`, `year`,
`all` e `custom`. Quando o tenant ainda não possui timezone persistido, o
fallback explícito é o timezone do runtime (`Intl.DateTimeFormat`), ou `UTC`
quando o runtime não informa um timezone. Datas de negócio são agrupadas nesse
timezone; timestamps armazenados não são alterados.

Semântica adotada:

- vendas, lucro, vendedores, clientes criados, compras, movimentações e
  lançamentos financeiros: fluxo/total do período;
- estoque, produtos e clientes ativos: snapshot atual;
- contas a receber/pagar: saldo aberto atual;
- margem: lucro das vendas / faturamento operacional do tenant;
- projeção: somente para períodos com base temporal suficiente e sempre rotulada
  como projeção; `recebíveis - pagáveis` é projeção líquida de compromissos, não
  caixa realizado;
- metas de equipe sem dados suficientes aparecem como indisponíveis, sem
  percentual inventado.

O Financeiro da plataforma continua separado: nenhuma métrica executiva consulta
ou agrega `financial_entries` de tenants como receita SaaS da F7.
