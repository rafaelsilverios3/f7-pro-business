import { F7AIOrchestrator } from './f7AIOrchestrator.ts';
import { authorizeAutonomousAction, classifyActionRisk } from './actionRisk.ts';
import { F7ToolRegistry } from './toolRegistry.ts';
import type { AutonomyMode, F7ActionProposal, F7IntelligenceEvent, F7MemoryCandidate } from './intelligenceContracts.ts';

export type F7IntelligenceEngineInput = {
  company_context: { company_id: string; autonomy_mode: AutonomyMode; segment?: string; business_description?: string; specific_rules?: string; [key: string]: unknown };
  actor: { type: string; id?: string | null };
  event: F7IntelligenceEvent;
  conversation_context: { latest_message: string };
  available_tools: unknown[];
  available_specialists: unknown[];
  policies: Record<string, unknown>;
  knowledge: unknown[];
  memory: unknown[];
  budget: Record<string, unknown>;
  permissions: string[];
  product_intelligence: any;
};

export type F7IntelligenceEngineResult = {
  decision: ReturnType<typeof F7AIOrchestrator.orchestrate>;
  decision_summary: string;
  reason_codes: string[];
  confidence: string;
  evidence: unknown[];
  proposed_actions: F7ActionProposal[];
  required_approvals: string[];
  follow_up: string[];
  memory_candidates: F7MemoryCandidate[];
  audit_metadata: Record<string, unknown>;
};

function failClosed(reason: string): never {
  throw Object.assign(new Error(reason), { code: reason });
}

export const F7IntelligenceEngine = Object.freeze({
  decide(input: F7IntelligenceEngineInput): F7IntelligenceEngineResult {
    if (!input.company_context?.company_id || input.event?.company_id !== input.company_context.company_id) failClosed('TENANT_CONTEXT_MISMATCH');
    if (!input.event.idempotency_key || input.event.depth > input.event.max_depth) failClosed('INVALID_EVENT_GUARD');
    const mode = input.company_context.autonomy_mode;
    if (mode === 'OFF') failClosed('AUTONOMY_OFF');

    const decision = F7AIOrchestrator.orchestrate({
      trace_id: input.event.correlation_id,
      message: input.conversation_context.latest_message,
      company: { ...input.company_context, mode: 'assisted' },
      product_intelligence: input.product_intelligence,
      automatic_policy: { enabled: false },
    });
    const availableSpecialistIds = new Set((input.available_specialists as Array<{ id?: string }>).map((item) => item?.id).filter(Boolean));
    if (!decision.specialist || !availableSpecialistIds.has(decision.specialist)) failClosed('SPECIALIST_NOT_AUTHORIZED');
    const availableToolNames = new Set((input.available_tools as Array<{ name?: string }>).map((item) => item?.name).filter(Boolean));
    const maxToolCalls = Math.max(0, Number(input.budget?.max_tool_calls_per_job ?? 8));
    if (decision.tools.length > maxToolCalls) failClosed('MAX_TOOL_CALLS_REACHED');
    for (const toolName of decision.tools) {
      const authorization = availableToolNames.has(toolName) ? F7ToolRegistry.authorize(toolName, input.permissions) : { allowed: false };
      if (!authorization.allowed) failClosed('TOOL_NOT_AUTHORIZED');
    }
    const actionType = ['ANSWER_WITH_OPTIONS', 'ANSWER_CONFIDENTLY', 'ASK_CUSTOMER'].includes(decision.selected_action)
      ? 'SEND_CUSTOMER_MESSAGE' : 'CREATE_INTERNAL_SUGGESTION';
    const risk = classifyActionRisk(actionType);
    const authorization = authorizeAutonomousAction(mode, risk);
    const evidence = Array.isArray(decision.evidence) ? decision.evidence.slice(0, 30) : [];
    const reasonCodes = [authorization.reason_code];
    if (decision.confidence === 'INSUFFICIENT') reasonCodes.push('INSUFFICIENT_EVIDENCE');
    if (decision.conflicts.length) reasonCodes.push('CONFLICTING_EVIDENCE');
    const proposal: F7ActionProposal = {
      action_type: actionType,
      risk_level: risk,
      title: actionType === 'SEND_CUSTOMER_MESSAGE' ? 'Responder cliente' : 'Revisar análise da F7',
      description: decision.explanation,
      payload: {},
      confidence: decision.confidence,
      evidence,
      requires_human: authorization.disposition === 'REQUIRE_APPROVAL' || authorization.disposition === 'PROPOSE' || !authorization.allowed,
    };
    return {
      decision: { ...decision, requires_human: proposal.requires_human, auto_reply_eligible: false, policy_result: { allowed: false, reason: authorization.reason_code }, execution: { status: 'awaiting_human_review', action: decision.selected_action, reason: authorization.reason_code } },
      decision_summary: `${decision.selected_action}:${decision.confidence}`,
      reason_codes: [...new Set(reasonCodes)],
      confidence: decision.confidence,
      evidence,
      proposed_actions: [proposal],
      required_approvals: proposal.requires_human ? ['HUMAN_OPERATOR'] : [],
      follow_up: decision.unresolved_facts.slice(0, 10),
      memory_candidates: [],
      audit_metadata: {
        event_id: input.event.id,
        correlation_id: input.event.correlation_id,
        specialist: decision.specialist,
        tools: decision.tools,
        autonomy_mode: mode,
        chain_of_thought_stored: false,
      },
    };
  },
});
