import { evaluateSourceTrust } from './sourceTrust.ts';

export const SUPPLIER_STATES = ['DESCOBERTO', 'EM_ANALISE', 'QUALIFICADO', 'DESCARTADO', 'SALVO'] as const;
export type SupplierState = typeof SUPPLIER_STATES[number];

const EDITORIAL = /\b(?:blog|article|artigo|guia|guide|ranking|ranked|review|reviews|resenha|lista|listicle|top\s+\d+|\d+\s+(?:best|top)|best\s+\d+|how\s+to|como\s+(?:escolher|funciona)|what\s+is|o\s+que\s+é|not[ií]cias|news|magazine|revista)\b/i;
const EDITORIAL_PATH = /(?:^|\/)(?:blog|article|articles|guide|guides|news|noticias|category|categories|author|tag|tags|review|reviews)(?:\/|$)/i;
const GENERIC_PAGE_TITLE = /^(?:home|homepage|in[ií]cio|p[aá]gina inicial|produtos|products|cat[aá]logo|catalog|fornecedores?|suppliers?|distribuidores?|fabricantes?|dropshipping|sobre|about|contato|contact|search|resultado|resultados)$/i;
const GENERIC_DOMAIN = /^(?:blog|news|medium|substack|wordpress|wixsite|blogspot|youtube|facebook|instagram|linkedin|wikipedia|reddit|quora|pinterest|google|bing|brave)$/i;
const OPERATION = /\b(?:fornecedor(?:es)?|supplier(?:s)?|distribuidor(?:es)?|distributor(?:s)?|atacad(?:o|ista|istas|istas)?|wholesale|dropship(?:ping)?|fabricante(?:s)?|manufacturer(?:s)?|f[aá]brica|ind[uú]stria|importador(?:es)?|importer(?:s)?|revenda|revendedor(?:es)?|supply|fornecemos|fornece|supplies|supply\s+to)\b/i;
const COMMERCIAL = /\b(?:cat[aá]logo|catalog(?:ue)?|produto(?:s)?|product(?:s)?|loja|store|shop|or[cç]amento|wholesale|atacado|distribui|fabric|manufactur|pre[cç]o|price|pedido|order|comprar|buy|oferta|offer|venda|sales)\b/i;
const ENTITY = /\b(?:ltda\.?|limitada|s\/?a\.?|eireli|inc\.?|llc|corp\.?|corporation|company|empresa|fabricante|distribuidor|atacadista|wholesaler|manufacturer|supplier|fornecedor)\b/i;
const LEGAL_ENTITY = /\b(?:ltda\.?|limitada|s\/?a\.?|eireli|inc\.?|llc|corp\.?|corporation)\b/i;

function text(value: unknown, max = 500) {
  return String(value || '').replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

function url(value: unknown) {
  try {
    const parsed = new URL(String(value || ''));
    return ['http:', 'https:'].includes(parsed.protocol) && !parsed.username && !parsed.password ? parsed : null;
  } catch { return null; }
}

function inferName(title: string, domain: string) {
  const cleanTitle = text(title, 180);
  const parts = cleanTitle.split(/\s+[|–—-]\s+|\s+[>»]\s+/).map((part) => part.trim()).filter(Boolean);
  const first = parts[0] || '';
  const last = parts.at(-1) || '';
  const titleName = parts.length > 1 && /^(?:home|produtos|products|cat[aá]logo|catalog|loja|store|shop|sobre|about|contato|contact)$/i.test(first) ? last : first;
  if (titleName && !GENERIC_PAGE_TITLE.test(titleName) && !EDITORIAL.test(titleName) && !/^\d+\s/.test(titleName)) return titleName;
  const label = domain.replace(/^www\./i, '').split('.')[0].replace(/[-_]+/g, ' ').trim();
  return label && !GENERIC_DOMAIN.test(label) ? label.replace(/\b\w/g, (match) => match.toUpperCase()) : '';
}

function hasBusinessIdentity(name: string, title: string, snippet: string) {
  // A supplier keyword anywhere on the page is not proof of the page owner's
  // identity. Require the proposed name itself to be tied to legal identity,
  // or repeated in a first-party statement that identifies the business.
  const proposed = name.toLocaleLowerCase('pt-BR').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  if (!proposed || GENERIC_PAGE_TITLE.test(name) || EDITORIAL.test(name)) return false;
  const fullText = `${title} ${snippet}`;
  const legalName = new RegExp(`${proposed.split(' ').filter((part) => part.length > 2).map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*')}.*\\b(?:ltda\\.?|limitada|s\\/?a\\.?|eireli|inc\\.?|llc|corp\\.?|corporation)\\b`, 'i');
  if (LEGAL_ENTITY.test(name) || legalName.test(fullText)) return true;
  const titleParts = title.split(/\s+[|–—-]\s+/).map((part) => part.trim());
  const brand = titleParts.find((part) => part.toLocaleLowerCase('pt-BR').replace(/[^\p{L}\p{N}]+/gu, ' ').trim() === proposed);
  if (!brand || !snippet.toLocaleLowerCase('pt-BR').includes(proposed)) return false;
  return ENTITY.test(snippet) && OPERATION.test(snippet) && COMMERCIAL.test(snippet);
}

function isEditorial(title: string, snippet: string, parsed: URL) {
  const path = `${parsed.pathname} ${parsed.hostname}`;
  return EDITORIAL.test(title) || EDITORIAL_PATH.test(path) || /\b(?:read our|leia nosso|last updated|updated guide|guia completo|lista completa|the best suppliers|melhores fornecedores)\b/i.test(snippet);
}

function classifySource(result: any, parsed: URL, title: string, snippet: string) {
  if (isEditorial(title, snippet, parsed)) return 'DISCOVERY_SOURCE';
  const explicitOperation = OPERATION.test(`${title} ${snippet}`);
  const commercialEvidence = COMMERCIAL.test(`${title} ${snippet}`);
  const namedBusiness = hasBusinessIdentity(inferName(title, parsed.hostname), title, snippet);
  if (explicitOperation && commercialEvidence && namedBusiness) return 'COMMERCIAL_EVIDENCE';
  return 'DISCOVERY_SOURCE';
}

function inferType(value: string) {
  if (/fabricante|manufacturer|ind[uú]stria|f[aá]brica/i.test(value)) return 'FABRICANTE';
  if (/distribu|atacad|wholesale/i.test(value)) return 'DISTRIBUIDOR/ATACADISTA';
  if (/dropship/i.test(value)) return 'DROPSHIPPING';
  if (/market|shop|store|loja|revend/i.test(value)) return 'REVENDEDOR/MARKETPLACE';
  return 'MODALIDADE NÃO COMPROVADA';
}

function regionEvidence(value: string) {
  if (/\b(?:Brasil|Brazil|brasileir[oa]s?|atendemos? o Brasil|envio para o Brasil|entrega para o Brasil)\b/i.test(value)) return 'CONFIRMADA';
  if (/\b(?:Am[eé]rica do Sul|South America|Latam)\b/i.test(value)) return 'INDÍCIO';
  return 'NÃO VERIFICADA';
}

function price(value: string) {
  const match = value.match(/(?:R\$|BRL|US\$|USD|€|EUR)\s*([\d.,]+)|([\d.,]+)\s*(?:R\$|BRL|US\$|USD|€|EUR)/i);
  if (!match) return null;
  const raw = match[1] || match[2];
  const normalized = raw.includes(',') && raw.lastIndexOf(',') > raw.lastIndexOf('.') ? raw.replace(/\./g, '').replace(',', '.') : raw.replace(/,/g, '');
  const amount = Number(normalized);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const currency = /R\$|BRL/i.test(match[0]) ? 'BRL' : /€|EUR/i.test(match[0]) ? 'EUR' : 'USD';
  return { amount, currency, unit: /caixa|kit|pack|box/i.test(value) ? 'embalagem (confirmar unidade)' : 'unidade (confirmar)', source_text: text(match[0], 80) };
}

function productTerms(query: string, category = '') {
  const ignored = new Set(['brasil', 'brazil', 'brasileiro', 'brasileira', 'fornecedor', 'fornecedores', 'supplier', 'suppliers', 'distribuidor', 'distribuidores', 'atacado', 'atacadista', 'wholesale', 'dropshipping', 'dropship', 'fabricante', 'fabricantes', 'distribuidor', 'empresa', 'empresas', 'para', 'com', 'sem', 'the', 'and', 'for', 'in']);
  return [...new Set(`${query} ${category}`.split(/\s+/).map((part) => text(part, 60).toLocaleLowerCase('pt-BR')).filter((part) => part.length >= 3 && !ignored.has(part)))].slice(0, 15);
}

/** Names found in editorial sources are leads only and must be verified by a separate search. */
export function extractSupplierMentions(results: any[]) {
  const leads = new Set<string>();
  for (const result of Array.isArray(results) ? results : []) {
    const parsed = url(result?.url);
    const title = text(result?.title, 240);
    const snippet = text(result?.snippet, 1000);
    if (!parsed || !isEditorial(title, snippet, parsed)) continue;
    const sourceText = `${title}. ${snippet}`;
    const patterns = [
      /\b(?:include|includes|including|such as|among them|companies like|suppliers like|for example|incluem|incluindo|como|entre eles|entre elas|empresas como|fornecedores como)\s+([^.;:]{3,180})/gi,
      /(?:^|\s)\d{1,2}[.)]\s+([A-ZÀ-Þ][^,;:.]{2,70}?)(?=\s+(?:[-–—:]|offers?|provides?|fornece|oferece|vende)|[,;.]|$)/g,
    ];
    for (const pattern of patterns) {
      for (const match of sourceText.matchAll(pattern)) {
        const list = (match[1] || '').split(/,|\s+and\s+|\s+e\s+/i).map((item) => text(item.replace(/\s+(?:and|e)$/i, ''), 80));
        for (const item of list) {
          const candidate = item.replace(/^(?:the|a|o|as?|os?)\s+/i, '').trim();
          if (candidate.length >= 3 && candidate.length <= 70 && !EDITORIAL.test(candidate) && !/^(?:Brazil|Brasil|suppliers?|fornecedores?)$/i.test(candidate)) leads.add(candidate);
          if (leads.size >= 6) break;
        }
        if (leads.size >= 6) break;
      }
    }
  }
  return [...leads].slice(0, 6);
}

export function buildSupplierCandidates(results: any[], requestedQuery: string, retrievedAt = new Date().toISOString(), filters: { category?: string; location?: string; commercial_model?: string } = {}) {
  const grouped = new Map<string, any>();
  const terms = productTerms(requestedQuery, filters.category);
  for (const result of Array.isArray(results) ? results : []) {
    const parsed = url(result?.url);
    if (!parsed) continue;
    const domain = parsed.hostname.toLowerCase();
    const title = text(result?.title, 240);
    const snippet = text(result?.snippet, 1000);
    if (!title && !snippet || isEditorial(title, snippet, parsed)) continue;
    const evidence = `${title} ${snippet}`;
    const relatedTerms = terms.filter((term) => evidence.toLocaleLowerCase('pt-BR').includes(term));
    const productMatch = Boolean(filters.category ? relatedTerms.some((term) => filters.category?.toLocaleLowerCase('pt-BR').includes(term)) : relatedTerms.length);
    const operationEvidence = OPERATION.test(evidence);
    const sourceRole = classifySource(result, parsed, title, snippet);
    const businessName = inferName(title, domain);
    const identity = Boolean(businessName) && hasBusinessIdentity(businessName, title, snippet);
    const commercialEvidence = sourceRole === 'COMMERCIAL_EVIDENCE';
    const region = regionEvidence(evidence);
    const trust = evaluateSourceTrust({ source_type: result?.source_type === 'manufacturer_official' ? 'manufacturer_official' : result?.source_type === 'approved_catalog' ? 'approved_catalog' : result?.source_type === 'distributor' ? 'distributor' : undefined, domain, company_identity_match: identity, evidence_count: 1, retrieved_at: result?.retrieved_at || retrievedAt });
    const source = { title, domain, url: parsed.toString(), evidence: snippet, retrieved_at: result?.retrieved_at || retrievedAt, source_type: result?.source_type || 'public_web', strength: sourceRole === 'COMMERCIAL_EVIDENCE' ? 'evidência comercial' : result?.source_type === 'manufacturer_official' ? 'fonte oficial indicada' : 'evidência pública', source_role: sourceRole, verification_query_for: text(result?.verification_query_for, 100) || null };
    const existing = grouped.get(domain);
    const evidenceRow = { name: businessName, identity_confirmed: identity, product_match: productMatch, operation_evidence: operationEvidence, commercial_evidence: commercialEvidence, region_status: region, modality: inferType(evidence), price: price(evidence), category: relatedTerms.slice(0, 6) };
    if (existing) {
      existing.sources.push(source);
      existing.evidence = [...new Set([...existing.evidence, snippet])].filter(Boolean).slice(0, 6);
      existing.related_terms = [...new Set([...existing.related_terms, ...relatedTerms])].slice(0, 12);
      existing.product_match ||= productMatch;
      existing.operation_evidence ||= operationEvidence;
      existing.commercial_evidence ||= commercialEvidence;
      existing.identity_confirmed ||= identity;
      if (existing.name_status !== 'CONFIRMADO' && identity) { existing.name = businessName; existing.name_status = 'CONFIRMADO'; }
      if (region === 'CONFIRMADA') existing.region_status = region;
      else if (region === 'INDÍCIO' && existing.region_status === 'NÃO VERIFICADA') existing.region_status = region;
      if (existing.modality === 'MODALIDADE NÃO COMPROVADA' && evidenceRow.modality !== existing.modality) existing.modality = evidenceRow.modality;
      existing.price = existing.price || evidenceRow.price;
    } else grouped.set(domain, { name: businessName, name_status: identity ? 'CONFIRMADO' : 'INFERIDO', type: evidenceRow.modality, product: text(filters.category || requestedQuery, 180), category: relatedTerms.slice(0, 6), related_terms: relatedTerms, location: region === 'CONFIRMADA' ? text(filters.location || 'Brasil', 100) : null, region_status: region, site: parsed.origin, evidence: snippet ? [snippet] : [], sources: [source], price: evidenceRow.price, product_match: productMatch, operation_evidence: operationEvidence, commercial_evidence: commercialEvidence, identity_confirmed: identity, trust_score: trust.score, trust_level: trust.level, trust_evidence: identity ? title : null, retrieved_at: result?.retrieved_at || retrievedAt });
  }
  return [...grouped.values()].map((candidate) => {
    const supplierProof = candidate.identity_confirmed && candidate.commercial_evidence && candidate.operation_evidence;
    const supportProof = candidate.product_match || terms.length === 0;
    const saveEligible = supplierProof && supportProof;
    const sourceCount = candidate.sources.length;
    const verifiedSources = candidate.sources.filter((source: any) => source.source_role === 'COMMERCIAL_EVIDENCE').length;
    const score = supplierProof ? Math.min(76, Math.round(candidate.trust_score * 45 + Math.min(20, verifiedSources * 10) + (candidate.product_match ? 11 : 0))) : Math.min(39, Math.round(candidate.trust_score * 32));
    const state: SupplierState = saveEligible ? 'QUALIFICADO' : candidate.identity_confirmed || candidate.operation_evidence ? 'EM_ANALISE' : 'DESCOBERTO';
    const risks = [];
    if (!candidate.identity_confirmed) risks.push('Identidade empresarial não confirmada; o título ou domínio não basta.');
    if (!candidate.commercial_evidence) risks.push('Não foi encontrada evidência comercial individual de catálogo, produto ou oferta.');
    if (!candidate.operation_evidence) risks.push('Atuação como fornecedor não foi demonstrada.');
    if (!candidate.product_match) risks.push('Categoria/produto solicitado não aparece claramente na fonte.');
    if (candidate.region_status !== 'CONFIRMADA') risks.push('Atendimento/localização no Brasil não está confirmado.');
    if (!candidate.price) risks.push('Preço não encontrado em fonte verificável.');
    const sources = candidate.sources.map((source: any) => ({ ...source, claims: { company_identity: candidate.identity_confirmed ? 'CONFIRMADA' : 'NÃO VERIFICADA', supplier_activity: candidate.operation_evidence ? 'EVIDÊNCIA ENCONTRADA' : 'NÃO VERIFICADA', category: candidate.product_match ? 'EVIDÊNCIA ENCONTRADA' : 'NÃO VERIFICADA', region: candidate.region_status } }));
    return { ...candidate, sources, state, score, confidence: score >= 65 ? 'ALTA' : score >= 40 ? 'MÉDIA' : 'BAIXA', qualification: saveEligible ? 'COMPROVADO' : 'PENDENTE DE VERIFICAÇÃO', save_eligible: saveEligible, risk_level: risks.length >= 4 ? 'ALTO' : risks.length ? 'MODERADO' : 'NÃO AVALIADO', risks, source_count: sourceCount, verified_source_count: verifiedSources, price_source: candidate.price ? candidate.sources.find((source: any) => source.evidence.includes(candidate.price.source_text))?.url || candidate.sources[0].url : null };
  }).sort((a, b) => b.score - a.score).slice(0, 20);
}

export function safeSupplierPayload(candidate: any) {
  const sources = Array.isArray(candidate?.sources) ? candidate.sources : [];
  const name = text(candidate?.name, 180);
  const verifiedSource = sources.find((source: any) => {
    const parsed = url(source?.url);
    if (!parsed) return false;
    const title = text(source?.title, 240);
    const evidence = text(source?.evidence, 1000);
    const identity = Boolean(inferName(title, parsed.hostname)) && hasBusinessIdentity(inferName(title, parsed.hostname), title, evidence);
    return classifySource(source, parsed, title, evidence) === 'COMMERCIAL_EVIDENCE' && identity && OPERATION.test(`${title} ${evidence}`) && inferName(title, parsed.hostname).toLocaleLowerCase('pt-BR') === name.toLocaleLowerCase('pt-BR');
  });
  const sourceUrl = url(verifiedSource?.url);
  const evidence = text(verifiedSource?.evidence, 1000);
  if (!sourceUrl || !name || GENERIC_PAGE_TITLE.test(name) || EDITORIAL.test(name)) return null;
  return { name, email: null, phone: null, source_url: sourceUrl.toString(), source_summary: evidence, metadata: { discovered: true, qualification: 'COMPROVADO', state: 'EM_ANALISE', product: text(candidate.product, 180), score: Math.min(Number(candidate.score) || 0, 76), sources: sources.filter((source: any) => url(source?.url)).slice(0, 10) } };
}
