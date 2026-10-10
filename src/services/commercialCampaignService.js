import { supabaseProvider } from '@/data/providers/supabaseProvider';
import { buildAtomicCampaignPayload, buildCampaignPreview, campaignTargetFromFact, summarizeCampaignUniverses } from '@/lib/commercialCampaign';
import { assertCampaignResumeWorkbookMatches } from '@/lib/campaignWorkbookGuards';
import { parseCampaignWorkbookInWorker } from '@/services/campaignWorkbookWorker';

export async function parseWorkbookFile(file, options = {}) {
  const workbook = await parseCampaignWorkbook(file, options);
  return workbook.actionRows;
}

export async function parseCampaignWorkbook(file, options = {}) {
  return parseCampaignWorkbookInWorker(file, options);
}

function assertWorkbookMatchesFile(workbook, file) {
  if (!workbook || !Array.isArray(workbook.actionRows) || !/^[a-f0-9]{64}$/.test(workbook.sourceFileHash || '')) {
    throw new Error('A prévia segura da planilha expirou. Selecione novamente o arquivo para analisá-lo.');
  }
  if (file && (workbook.sourceFileName !== file.name || workbook.sourceFileSize !== file.size)) {
    throw new Error('O arquivo selecionado mudou após a prévia. Gere uma nova prévia antes de importar.');
  }
}

export async function importCommercialCampaign({ company, file, workbook: parsedWorkbook }) {
  if (!company?.id || !company?.name) throw new Error('Empresa não selecionada.');
  const workbook = parsedWorkbook || await parseCampaignWorkbook(file);
  assertWorkbookMatchesFile(workbook, file);
  const result = await supabaseProvider.rpc('import_commercial_campaign_atomic', { p_target_company: company.id, ...buildAtomicCampaignPayload(workbook) });
  return { status: result?.status, alreadyImported: result?.status === 'already_imported', campaignId: result?.campaign_id, importId: result?.import_id, counts: result?.counts || {} };
}

export async function resumeCommercialCampaignImport({ company, file, workbook: parsedWorkbook, importRecord }) {
  if (!company?.id || (!file && !parsedWorkbook) || !importRecord?.id) throw new Error('Selecione novamente o arquivo da campanha parcial.');
  const workbook = parsedWorkbook || await parseCampaignWorkbook(file);
  assertWorkbookMatchesFile(workbook, file);
  assertCampaignResumeWorkbookMatches(workbook, importRecord);
  const result = await supabaseProvider.rpc('resume_commercial_campaign_import_atomic', {
    p_target_company: company.id,
    p_file_name: workbook.sourceFileName,
    p_file_hash: workbook.sourceFileHash,
    p_history_rows: workbook.historyRows,
    p_action_rows: workbook.actionRows,
  });
  return { status: result?.status, campaignId: result?.campaign_id, importId: result?.import_id, counts: result?.counts || {} };
}

export async function loadTenantCatalog(companyId) {
  if (!companyId) throw new Error('Empresa não selecionada.');
  const [customers, products] = await Promise.all([
    supabaseProvider.entity('Customer').filter({ company_id: companyId }, 'name', 1000),
    supabaseProvider.entity('Product').filter({ company_id: companyId }, 'name', 1000),
  ]);
  return { customers, products };
}

export async function buildTenantCampaignPreview({ companyId, rows }) {
  const catalog = await loadTenantCatalog(companyId);
  return buildCampaignPreview({ rows, ...catalog });
}

export async function buildFullCampaignPreview({ companyId, workbook }) {
  const catalog = await loadTenantCatalog(companyId);
  return {
    ...summarizeCampaignUniverses({ ...workbook, ...catalog }),
    persisted: false,
  };
}

export function buildPreviewTargetRows(preview) {
  return (preview?.facts || []).map((fact) => campaignTargetFromFact(fact, fact.source?.priority));
}

export const campaignEntities = Object.freeze({
  campaigns: 'CommercialCampaign',
  imports: 'CommercialCampaignImport',
  facts: 'CommercialCampaignFact',
  targets: 'CommercialCampaignTarget',
  outcomes: 'CommercialCampaignOutcome',
});

export async function listCampaigns(companyId) {
  return supabaseProvider.entity(campaignEntities.campaigns).filter({ company_id: companyId }, '-created_at', 100);
}

export async function listSuccessfulCampaignImports(companyId) {
  return supabaseProvider.entity(campaignEntities.imports).filter({ company_id: companyId, status: 'imported' }, '-created_at', 100);
}

export async function recordCampaignReview({ companyId, targetId, decision, reviewReason }) {
  if (!['existing', 'new', 'ignore'].includes(decision)) throw new Error('Decisão de revisão inválida.');
  return supabaseProvider.entity(campaignEntities.targets).update(targetId, { company_id: companyId, match_status: decision === 'existing' ? 'reviewed' : decision === 'new' ? 'new' : 'invalid', review_reason: reviewReason || null });
}
