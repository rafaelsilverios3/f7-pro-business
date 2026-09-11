import type { ActionRiskLevel, AutonomyMode } from './intelligenceContracts.ts';

const READ_ONLY = new Set(['SEARCH_WEB', 'READ_CATALOG', 'READ_STOCK', 'READ_CUSTOMER', 'READ_FINANCE', 'ANALYZE']);
const LOW_RISK = new Set(['CREATE_ALERT', 'CREATE_INSIGHT', 'CREATE_INTERNAL_SUGGESTION']);
const MEDIUM_RISK = new Set(['DRAFT_QUOTE', 'CREATE_TASK', 'DRAFT_CUSTOMER_MESSAGE']);
const HIGH_RISK = new Set(['SEND_CUSTOMER_MESSAGE', 'CHANGE_PRICE', 'CHANGE_STOCK', 'CREATE_SALE', 'REGISTER_PAYMENT']);
const CRITICAL = new Set(['MOVE_MONEY', 'DELETE_DATA', 'CHANGE_SECURITY', 'CHANGE_PERMISSIONS', 'IRREVERSIBLE_OPERATION']);

export function classifyActionRisk(actionType: string): ActionRiskLevel {
  const action = String(actionType || '').trim().toUpperCase();
  if (READ_ONLY.has(action)) return 'READ_ONLY';
  if (LOW_RISK.has(action)) return 'LOW_RISK';
  if (MEDIUM_RISK.has(action)) return 'MEDIUM_RISK';
  if (HIGH_RISK.has(action)) return 'HIGH_RISK';
  if (CRITICAL.has(action)) return 'CRITICAL';
  return 'CRITICAL';
}
export type ActionAuthorization = {
  allowed: boolean;
  disposition: 'EXECUTE' | 'EXECUTE_INTERNAL' | 'PROPOSE' | 'REQUIRE_APPROVAL' | 'BLOCK';
  reason_code: string;
};

export function authorizeAutonomousAction(mode: AutonomyMode, risk: ActionRiskLevel): ActionAuthorization {
  if (mode === 'OFF') return { allowed: false, disposition: 'BLOCK', reason_code: 'AUTONOMY_OFF' };
  if (mode === 'ASSISTED') return { allowed: false, disposition: 'PROPOSE', reason_code: 'ASSISTED_REQUIRES_USER_REQUEST' };
  if (mode === 'AUTONOMOUS') return { allowed: false, disposition: 'BLOCK', reason_code: 'AUTONOMOUS_RESERVED' };
  if (risk === 'READ_ONLY') return { allowed: true, disposition: 'EXECUTE', reason_code: 'READ_ONLY_ALLOWED' };
  if (risk === 'LOW_RISK') return { allowed: true, disposition: 'EXECUTE_INTERNAL', reason_code: 'LOW_RISK_INTERNAL_ONLY' };
  if (risk === 'MEDIUM_RISK') return { allowed: false, disposition: 'PROPOSE', reason_code: 'MEDIUM_RISK_DRAFT_ONLY' };
  if (risk === 'HIGH_RISK') return { allowed: false, disposition: 'REQUIRE_APPROVAL', reason_code: 'HIGH_RISK_REQUIRES_HUMAN' };
  return { allowed: false, disposition: 'BLOCK', reason_code: 'CRITICAL_ACTION_BLOCKED' };
}
