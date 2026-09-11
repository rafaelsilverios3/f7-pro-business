import { getSupabaseClient } from '@/data/providers/supabaseProvider';

export const actionProposalService = {
  active: async (companyId, conversationId) => {
    const { data, error } = await getSupabaseClient().from('action_proposals').select('*').eq('company_id', companyId).eq('conversation_id', conversationId).eq('status', 'PENDING_APPROVAL').order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (error) throw error;
    return data || null;
  },
  review: async ({ companyId, proposalId, decision, payload = null, rejectionReason = null, feedbackType = null }) => {
    const { data, error } = await getSupabaseClient().rpc('review_intelligence_proposal', {
      target_company: companyId,
      target_proposal: proposalId,
      target_decision: decision,
      target_payload: payload,
      target_rejection_reason: rejectionReason,
      target_feedback_type: feedbackType,
    });
    if (error) throw error;
    return data;
  },
};
