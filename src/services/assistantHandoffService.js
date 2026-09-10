import { getSupabaseClient } from '@/data/providers/supabaseProvider';

export const assistantHandoffService = {
  active: async (companyId, conversationId) => {
    const { data, error } = await getSupabaseClient().from('assistant_handoffs').select('*').eq('company_id', companyId).eq('conversation_id', conversationId).in('status', ['pending', 'assigned']).order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (error) throw error;
    return data || null;
  },
  create: async (companyId, conversationId, dossier = {}) => {
    const { data, error } = await getSupabaseClient().rpc('create_assistant_handoff', {
      target_company: companyId,
      target_conversation: conversationId,
      target_job: dossier.job_id || null,
      target_trace: dossier.trace_id || null,
      target_reason: dossier.reason || 'manual_transfer',
      target_summary: dossier.summary || null,
      target_known_facts: dossier.known_facts || [],
      target_unresolved_facts: dossier.unresolved_facts || [],
      target_candidates: dossier.candidates || [],
      target_sources: dossier.sources || [],
    });
    if (error) throw error;
    return data;
  },
  claim: async (companyId, handoffId) => {
    const { data, error } = await getSupabaseClient().rpc('claim_assistant_handoff', { target_company: companyId, target_handoff: handoffId });
    if (error) throw error;
    return data;
  },
  resolve: async (companyId, handoffId, status = 'resolved') => {
    const { data, error } = await getSupabaseClient().rpc('resolve_assistant_handoff', { target_company: companyId, target_handoff: handoffId, target_status: status });
    if (error) throw error;
    return data;
  },
};
