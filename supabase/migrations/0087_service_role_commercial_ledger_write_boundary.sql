-- Conceptual rollback: retain this boundary and resolve any discovered writer
-- through an audited, tenant-checked RPC. Regranting direct ledger DML would
-- restore a service-role path that bypasses transactional business checks.
-- No application rows are changed.

-- The Supabase role bootstrap grants service_role broad table DML. Keep reads
-- for backend reporting, but route all sales/stock ledger mutations through
-- the authenticated, validated transactional RPCs.
revoke insert, update, delete on table
  public.sales,
  public.sale_items,
  public.stock_movements
from service_role;
