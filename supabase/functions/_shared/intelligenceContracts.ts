export const AUTONOMY_MODES = ['OFF', 'ASSISTED', 'SUPERVISED_AUTONOMOUS', 'AUTONOMOUS'] as const;
export type AutonomyMode = typeof AUTONOMY_MODES[number];

export const ACTION_RISK_LEVELS = ['READ_ONLY', 'LOW_RISK', 'MEDIUM_RISK', 'HIGH_RISK', 'CRITICAL'] as const;
export type ActionRiskLevel = typeof ACTION_RISK_LEVELS[number];

export const INTELLIGENCE_EVENT_TYPES = [
  'CUSTOMER_MESSAGE_RECEIVED', 'SALE_CREATED', 'SALE_PARTIALLY_PAID', 'SALE_OVERDUE',
  'STOCK_LOW', 'PRODUCT_OUT_OF_STOCK', 'QUOTE_CREATED', 'QUOTE_EXPIRED',
  'CUSTOMER_INACTIVE', 'SUPPLIER_PRICE_CHANGED', 'OPPORTUNITY_DETECTED',
  'PAYMENT_OVERDUE', 'PURCHASE_CREATED', 'AUTOMATION_TRIGGERED', 'MANUAL_AI_REQUEST',
] as const;
export type IntelligenceEventType = typeof INTELLIGENCE_EVENT_TYPES[number];

export type F7IntelligenceEvent = {
  id: string;
  company_id: string;
  event_type: IntelligenceEventType;
  source_type: string;
  source_id: string;
  actor_type: string;
  actor_id?: string | null;
  payload: Record<string, unknown>;
  occurred_at: string;
  created_at?: string;
  correlation_id: string;
  causation_id?: string | null;
  depth: number;
  max_depth: number;
  idempotency_key: string;
};
export type F7ActionProposal = {
  action_type: string;
  risk_level: ActionRiskLevel;
  title: string;
  description: string;
  payload: Record<string, unknown>;
  confidence: 'CONFIRMED' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INSUFFICIENT';
  evidence: unknown[];
  requires_human: boolean;
};

export type F7MemoryCandidate = {
  scope: 'COMPANY';
  company_id: string;
  memory_type: 'EPISODIC' | 'SEMANTIC' | 'PROCEDURAL';
  subject: string;
  predicate: string;
  value: unknown;
  confidence: number;
  source_type: string;
  source_reference?: string | null;
  evidence: unknown[];
  status: 'CANDIDATE';
};
