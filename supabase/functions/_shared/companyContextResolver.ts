export type CompanyContextResult = {
  messages: any[];
  products: any[];
  quick_replies: any[];
  handoff_rules: any[];
  knowledge: any[];
  memory: any[];
  verified_applications: any[];
  cross_references: any[];
};

function isMissingOptionalResource(error: any) {
  const code = String(error?.code || '').toUpperCase();
  const message = String(error?.message || '').toLowerCase();
  return code === '42P01' || code === 'PGRST205' || message.includes('does not exist') || message.includes('could not find the table');
}

export async function resolveCompanyContext(input: { sb: any; company_id: string; conversation_id: string; max_messages: number }) : Promise<CompanyContextResult> {
  if (!input.company_id || !input.conversation_id) throw Object.assign(new Error('TENANT_CONTEXT_REQUIRED'), { code: 'TENANT_CONTEXT_REQUIRED' });
  const resources = [
    { key: 'messages', query: input.sb.from('messages').select('id,sender_type,content,message_type,created_at').eq('company_id', input.company_id).eq('conversation_id', input.conversation_id).order('created_at', { ascending: false }).limit(input.max_messages) },
    { key: 'products', query: input.sb.from('products').select('id,name,sku,price,stock,active').eq('company_id', input.company_id).eq('active', true).limit(200) },
    { key: 'quick_replies', query: input.sb.from('company_quick_replies').select('reply_key,title,body,category,active').eq('company_id', input.company_id).eq('active', true).limit(100) },
    { key: 'handoff_rules', query: input.sb.from('company_handoff_rules').select('trigger_key,label,enabled,priority').eq('company_id', input.company_id).eq('enabled', true).order('priority').limit(100) },
    { key: 'knowledge', optional: true, query: input.sb.from('company_knowledge').select('knowledge_type,subject_key,fact_key,fact_value,source_type,confidence,scope,verified_at').eq('company_id', input.company_id).eq('status', 'active').order('verified_at', { ascending: false }).limit(100) },
    { key: 'memory', optional: true, query: input.sb.from('intelligence_memory').select('memory_type,subject,predicate,value,confidence,source_type,source_reference,evidence,valid_from,valid_until,status').eq('company_id', input.company_id).eq('scope', 'COMPANY').eq('status', 'VALIDATED').limit(50) },
    { key: 'verified_applications', optional: true, query: input.sb.from('verified_product_applications').select('manufacturer,machine_model,machine_year,serial_range,system,assembly,position,part_number,source_refs,verification_state,verified_at').eq('company_id', input.company_id).in('verification_state', ['candidate', 'verified']).limit(100) },
    { key: 'cross_references', optional: true, query: input.sb.from('part_cross_references').select('original_part_number,equivalent_part_number,original_manufacturer,equivalent_manufacturer,relation_type,evidence,confidence').eq('company_id', input.company_id).limit(100) },
  ];
  const results = await Promise.all(resources.map((resource) => resource.query));
  const failure = results.findIndex((result, index) => {
    if (!result.error) return false;
    return !(resources[index] as any).optional || !isMissingOptionalResource(result.error);
  });
  if (failure >= 0) throw Object.assign(new Error('COMPANY_CONTEXT_LOOKUP_FAILED'), { code: 'COMPANY_CONTEXT_LOOKUP_FAILED', resource: resources[failure].key, cause: results[failure].error });
  return Object.fromEntries(resources.map((resource, index) => [resource.key, results[index].error ? [] : results[index].data || []])) as CompanyContextResult;
}
