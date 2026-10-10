-- Etapa 19.6G: incluir produtos recém-criados no mapa de matching.
--
-- A 0082 cria os produtos novos antes de montar facts/targets, mas a tabela
-- temporária campaign_product_catalog foi materializada antes desse INSERT.
-- Assim, produtos novos permaneciam com match_count = 0 e todas as relações
-- cliente x produto eram bloqueadas. Esta migration é aditiva: recompõe a
-- definição já publicada e insere os produtos atuais no catálogo temporário
-- antes do matching. A regra 0/1/múltiplas correspondências permanece intacta.

do $$
declare
  function_sql text;
  old_anchor text := 'update campaign_product_map m';
  new_anchor text := $anchor$
  insert into campaign_product_catalog(id, sku_key, name_key)
    select p.id,
           public.commercial_campaign_normalize(p.sku),
           public.commercial_campaign_normalize(p.name)
      from public.products p
     where p.company_id = p_target_company
       and not exists (select 1 from campaign_product_catalog c where c.id = p.id);

  update campaign_product_map m
$anchor$;
begin
  select pg_get_functiondef(p.oid)
    into function_sql
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname = 'import_commercial_campaign_atomic'
     and p.pronargs = 9;

  if function_sql is null then
    raise exception 'RPC import_commercial_campaign_atomic não encontrada';
  end if;

  if position(old_anchor in function_sql) = 0 then
    raise exception 'Âncora do matching de produtos não encontrada';
  end if;

  function_sql := replace(function_sql, old_anchor, new_anchor);
  execute function_sql;
end;
$$;
-- Conceptual rollback: restore the exact import RPC body from 0082 (or the
-- verified pre-0083 database definition). This DO block only rewrites function
-- code; it does not reverse imports already committed under that code. Reconcile
-- persisted campaign/customer/product rows separately if their content is at issue.
