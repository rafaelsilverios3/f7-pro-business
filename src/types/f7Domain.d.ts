export type NumericValue = number | string | null;
export type DateValue = string | Date | null;

export type PeriodContext = {
  company_id: string;
  start_date: string | null;
  end_date: string | null;
  timezone: string;
  period_key: string;
};

export type PeriodOptions = {
  companyId?: string;
  periodKey?: string;
  timezone?: string;
  now?: Date;
  startDate?: string | null;
  endDate?: string | null;
};

export type SaleItem = {
  id?: string;
  product_id?: string;
  productId?: string;
  name?: string;
  product_name?: string;
  sku?: string;
  quantity?: NumericValue;
  qty?: NumericValue;
  price?: NumericValue;
  cost?: NumericValue;
  total?: NumericValue;
};

export type Sale = {
  id: string;
  company_id?: string;
  customer_id?: string;
  customer_name?: string;
  seller?: string;
  status?: string;
  payment_method?: string;
  sale_date?: DateValue;
  created_at?: DateValue;
  created_date?: DateValue;
  total?: NumericValue;
  profit?: NumericValue;
  items?: SaleItem[];
};

export type Customer = {
  id: string;
  company_id?: string;
  name?: string;
  email?: string;
  document?: string;
  status?: string;
  created_at?: DateValue;
  created_date?: DateValue;
  updated_date?: DateValue;
  last_purchase_date?: DateValue;
  total_purchased?: number;
  sale_count?: number;
};

export type Product = {
  id: string;
  company_id?: string;
  name?: string;
  sku?: string;
  barcode?: string;
  category?: string;
  item_type?: string;
  unit?: string;
  active?: boolean;
  stock?: NumericValue;
  min_stock?: NumericValue;
  minimum_stock?: NumericValue;
  price?: NumericValue;
  sale_price?: NumericValue;
};

export type OpportunityMetadata = {
  entity_type?: string;
  entity_id?: string;
  radar_state?: string;
  signal_type?: string;
  suggested_action?: string;
  [key: string]: unknown;
};

export type Opportunity = {
  id: string;
  company_id?: string;
  customer_id?: string;
  product_id?: string;
  kind?: string;
  title?: string;
  description?: string;
  stage?: string;
  status?: string;
  source?: string;
  source_type?: string;
  value?: NumericValue;
  score?: number | null;
  priority_rank?: number;
  priority?: string;
  next_action?: string;
  created_at?: DateValue;
  created_date?: DateValue;
  due_at?: DateValue;
  due_date?: DateValue;
  expected_close_date?: DateValue;
  metadata?: OpportunityMetadata;
};

export type CrmActivity = {
  id: string;
  company_id?: string;
  customer_id?: string;
  opportunity_id?: string;
  assigned_to?: string;
  activity_type?: string;
  title?: string;
  description?: string;
  status?: string;
  due_at?: DateValue;
  created_at?: DateValue;
  completed_at?: DateValue;
  cancelled_at?: DateValue;
};

export type Quote = {
  id: string;
  company_id?: string;
  customer_id?: string;
  status?: string;
  total?: NumericValue;
  created_at?: DateValue;
  created_date?: DateValue;
};

export type Conversation = {
  id: string;
  company_id?: string;
  customer_id?: string;
  subject?: string;
  channel?: string;
  created_at?: DateValue;
  updated_at?: DateValue;
  last_message_at?: DateValue;
};

export type Notification = {
  id?: string;
  company_id?: string;
  type?: string;
  entity?: string;
  entity_id?: string;
  title?: string;
  message?: string;
  read?: boolean;
};

export type Purchase = {
  id: string;
  company_id?: string;
  supplier_id?: string;
  status?: string;
  items?: PurchaseItem[];
  created_at?: DateValue;
  created_date?: DateValue;
  expected_date?: DateValue;
};

export type PurchaseItem = SaleItem & { purchase_id?: string; supplier_id?: string };

export type Supplier = {
  id: string;
  company_id?: string;
  name?: string;
};

export type SalesChannel = {
  id: string;
  company_id?: string;
  name?: string;
  status?: string;
};

export type ChannelMetric = {
  id: string;
  company_id?: string;
  channel_id?: string;
  created_at?: DateValue;
  created_date?: DateValue;
};

export type FinancialEntry = {
  id: string;
  company_id?: string;
  type?: string;
  status?: string;
  nature?: string;
  description?: string;
  category?: string;
  amount?: NumericValue;
  due_date?: DateValue;
  paid_date?: DateValue;
  created_date?: DateValue;
  cancelled_date?: DateValue;
  sale_id?: string;
};
