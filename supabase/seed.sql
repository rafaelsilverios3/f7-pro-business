-- Seed opcional de desenvolvimento. Não cria usuários Auth fictícios.
insert into companies (id, name) values ('00000000-0000-0000-0000-000000000001', 'F7 Demo') on conflict (id) do nothing;
insert into customers (company_id, name, email) values ('00000000-0000-0000-0000-000000000001', 'Cliente Demo', 'demo@example.com') on conflict do nothing;
insert into products (company_id, name, sku, cost, price, stock, minimum_stock) values ('00000000-0000-0000-0000-000000000001', 'Produto Demo', 'DEMO-001', 10, 25, 20, 5) on conflict do nothing;
