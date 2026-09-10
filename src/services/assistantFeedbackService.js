import { getSupabaseClient } from '@/data/providers/supabaseProvider';

const bounded = (value, limit = 4000) => typeof value === 'string' ? value.trim().slice(0, limit) : null;

export const assistantFeedbackService = {
  record: async ({ companyId, conversationId, messageId = null, traceId = null, type, originalSuggestion = null, finalResponse = null, details = {} }) => {
    const payload = {
      company_id: companyId,
      conversation_id: conversationId,
      message_id: messageId,
      trace_id: bounded(traceId, 120),
      feedback_type: type,
      original_suggestion: bounded(originalSuggestion),
      final_response: bounded(finalResponse),
      structured_feedback: details && typeof details === 'object' && !Array.isArray(details) ? details : {},
    };
    const { data, error } = await getSupabaseClient().from('assistant_feedback').insert(payload).select('id').single();
    if (error) throw error;
    return data;
  },
  promote: async ({ companyId, feedbackId, knowledgeType, subjectKey, factKey, factValue, confidence = 1 }) => {
    const { data, error } = await getSupabaseClient().rpc('promote_assistant_feedback_to_knowledge', { target_company: companyId, target_feedback: feedbackId, target_knowledge_type: knowledgeType, target_subject_key: subjectKey, target_fact_key: factKey, target_fact_value: factValue, target_confidence: confidence });
    if (error) throw error;
    return data;
  },
};
