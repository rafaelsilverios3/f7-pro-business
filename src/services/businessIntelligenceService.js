import { getSupabaseClient } from '@/data/providers/supabaseProvider';

const PAGE_SIZE = 1000;
const INSERT_BATCH = 200;

function throwIfError(error, message) {
  if (!error) return;
  const cause = Object.assign(new Error(message), {
    code: error.code || 'BI_REQUEST_FAILED',
    details: error.message,
  });
  throw cause;
}

export async function listBIStudies(companyId) {
  const { data, error } = await getSupabaseClient().from('bi_studies').select('*').eq('company_id', companyId).order('updated_at', { ascending: false });
  throwIfError(error, 'Não foi possível carregar os estudos.');
  return data || [];
}

export async function createBIStudy({ companyId, userId, name, clientName, description }) {
  const { data, error } = await getSupabaseClient().from('bi_studies').insert({ company_id: companyId, created_by: userId, name: String(name ?? '').trim(), client_name: String(clientName ?? '').trim() || null, description: String(description ?? '').trim() || null }).select('*').single();
  throwIfError(error, 'Não foi possível criar o estudo.');
  return data;
}

export async function updateBIStudy(companyId, studyId, changes) {
  const { data, error } = await getSupabaseClient().from('bi_studies').update({ ...changes, updated_at: new Date().toISOString() }).eq('company_id', companyId).eq('id', studyId).select('*').single();
  throwIfError(error, 'Não foi possível atualizar o estudo.');
  return data;
}

export async function listBIImports(companyId, studyId) {
  const { data, error } = await getSupabaseClient().from('bi_imports').select('*').eq('company_id', companyId).eq('study_id', studyId).order('version', { ascending: false });
  throwIfError(error, 'Não foi possível carregar as versões do estudo.');
  return data || [];
}

export async function loadBIItems(companyId, importId) {
  const client = getSupabaseClient();
  const rows = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await client.from('bi_items').select('*').eq('company_id', companyId).eq('import_id', importId).order('unit_name').order('code').range(from, from + PAGE_SIZE - 1);
    throwIfError(error, 'Não foi possível carregar os itens da versão.');
    rows.push(...(data || []));
    if (!data || data.length < PAGE_SIZE) break;
  }
  return rows;
}

export async function loadBIDecisions(companyId, importId) {
  const { data, error } = await getSupabaseClient().from('bi_decisions').select('*').eq('company_id', companyId).eq('import_id', importId).order('created_at', { ascending: false });
  throwIfError(error, 'Não foi possível carregar o histórico de decisões.');
  return data || [];
}

export async function loadBIAudit(companyId, studyId) {
  const { data, error } = await getSupabaseClient().from('bi_audit_events').select('id,event_type,actor_id,metadata,created_at,import_id').eq('company_id', companyId).eq('study_id', studyId).order('created_at', { ascending: false }).limit(100);
  throwIfError(error, 'Não foi possível carregar a auditoria do estudo.');
  return data || [];
}

export async function persistBIImport({ companyId, userId, studyId, file, parsed, dataCutoff, sourceNote }) {
  const client = getSupabaseClient();
  const { data: versions, error: versionError } = await client.from('bi_imports').select('version').eq('company_id', companyId).eq('study_id', studyId).order('version', { ascending: false }).limit(1);
  throwIfError(versionError, 'Não foi possível determinar a versão seguinte.');
  const version = Number(versions?.[0]?.version || 0) + 1;
  const { data: record, error: createError } = await client.from('bi_imports').insert({
    company_id: companyId,
    study_id: studyId,
    version,
    source_filename: file.name.slice(0, 255),
    source_sha256: parsed.source_sha256,
    data_cutoff: dataCutoff || null,
    source_metadata: { ...parsed.source_metadata, model: parsed.model, operator_note: sourceNote.trim() || null, raw_file_retained: false },
    methodology: parsed.methodology,
    row_count: parsed.items.length,
    status: 'staging',
    created_by: userId,
  }).select('*').single();
  throwIfError(createError, 'Não foi possível iniciar a nova versão.');

  try {
    for (let offset = 0; offset < parsed.items.length; offset += INSERT_BATCH) {
      const batch = parsed.items.slice(offset, offset + INSERT_BATCH).map((item) => ({ ...item, id: undefined, company_id: companyId, study_id: studyId, import_id: record.id }));
      const { error } = await client.from('bi_items').insert(batch);
      throwIfError(error, `A importação parou no lote ${Math.floor(offset / INSERT_BATCH) + 1}.`);
    }
    const { data: completed, error: completeError } = await client.from('bi_imports').update({ status: 'complete', completed_at: new Date().toISOString() }).eq('company_id', companyId).eq('id', record.id).eq('status', 'staging').select('*').single();
    throwIfError(completeError, 'Os itens foram importados, mas a versão não pôde ser confirmada.');
    return completed;
  } catch (cause) {
    await client.from('bi_imports').update({ status: 'failed' }).eq('company_id', companyId).eq('id', record.id).eq('status', 'staging');
    throw cause;
  }
}

export async function recordBIDecision({ companyId, userId, studyId, importId, item, status, reason, adjustedQuantity }) {
  const { data, error } = await getSupabaseClient().from('bi_decisions').insert({
    company_id: companyId,
    study_id: studyId,
    import_id: importId,
    item_id: item.id,
    status,
    reason: reason.trim(),
    adjusted_quantity: status === 'adjusted' ? Number(adjustedQuantity) : null,
    original_recommendation: item.original_recommendation || { eligible: item.eligible_for_suggestion, quantity: item.suggested_quantity, reasons: item.review_reasons },
    actor_id: userId,
  }).select('*').single();
  throwIfError(error, 'Não foi possível registrar a decisão.');
  return data;
}

export async function callBIShare(payload) {
  const { data, error } = await getSupabaseClient().functions.invoke('f7-bi-share', { body: payload });
  throwIfError(error, data?.code || 'Não foi possível concluir a operação de compartilhamento.');
  if (data?.code && data.code !== 'OK') {
    const cause = Object.assign(new Error(data.message || data.code), { code: data.code });
    throw cause;
  }
  return data;
}
