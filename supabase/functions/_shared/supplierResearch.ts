import { evaluateSourceTrust } from './sourceTrust.ts';

export const SUPPLIER_STATES = ['DESCOBERTO', 'EM_ANALISE', 'QUALIFICADO', 'DESCARTADO', 'SALVO'] as const;
export type SupplierState = typeof SUPPLIER_STATES[number];

function text(value: unknown, max = 500) {
  return String(value || '').replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

function url(value: unknown) {
  try { const parsed = new URL(String(value || '')); return ['http:', 'https:'].includes(parsed.protocol) ? parsed : null; } catch { return null; }
}

function sourceLabel(sourceType: string, domain: string) {
  if (sourceType === 'manufacturer_official') return 'site oficial/fabricante';
  if (sourceType === 'approved_catalog') return 'catálogo aprovado';
  if (sourceType === 'distributor') return 'distribuidor/comercial';
  if (/market|shop|store|atac|distrib/i.test(domain)) return 'comercial';
  return 'web pública';
}

function inferName(title: string, domain: string) {
  const first = text(title, 180).split(/\s+[|–—-]\s+|\s+[>»]\s+/)[0].trim();
  if (first && !/^(resultado|search|página|page|produto|product|home)$/i.test(first)) return first;
  return domain.replace(/^www\./i, '').split('.')[0].replace(/[-_]+/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase());
}

function inferType(value: string) {
  if (/fabricante|manufacturer|indústria|industria/i.test(value)) return 'FABRICANTE';
  if (/distribu|atacad|wholesale/i.test(value)) return 'DISTRIBUIDOR';
  if (/market|shop|store|loja/i.test(value)) return 'REVENDEDOR/MARKETPLACE';
  return 'FORNECEDOR POTENCIAL';
}

function regionMatch(value: string, requested: string) {
  if (!requested) return null;
  const south = /brasil|brazil|sul[- ]americana?|south\s+america|latam|s[aã]o\s+paulo|paran[aá]|minas\s+gerais|rio\s+de\s+janeiro/i.test(value);
  return south ? (requested.toLowerCase().includes('brasil') || requested.toLowerCase().includes('south') || requested.toLowerCase().includes('sul') ? true : null) : false;
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

export function buildSupplierCandidates(results: any[], requestedQuery: string, retrievedAt = new Date().toISOString()) {
  const grouped = new Map<string, any>();
  for (const result of Array.isArray(results) ? results : []) {
    const parsed = url(result?.url);
    if (!parsed) continue;
    const domain = parsed.hostname.toLowerCase();
    const title = text(result?.title, 240);
    const snippet = text(result?.snippet, 1000);
    if (!title && !snippet) continue;
    const evidence = `${title} ${snippet}`;
    const queryTerms = requestedQuery.split(/\s+/).map((part) => text(part, 60)).filter((part) => part.length >= 3).slice(0, 12);
    const relatedTerms = [...new Set(queryTerms.filter((part) => evidence.toLocaleLowerCase().includes(part.toLocaleLowerCase())))];
    const productMatch = relatedTerms.length > 0;
    const regional = regionMatch(evidence, requestedQuery);
    const trust = evaluateSourceTrust({ source_type: result?.source_type, domain, evidence_count: 1, retrieved_at: result?.retrieved_at || retrievedAt });
    const existing = grouped.get(domain);
    const source = { title, domain, url: parsed.toString(), evidence: snippet, retrieved_at: result?.retrieved_at || retrievedAt, source_type: result?.source_type || 'public_web', strength: sourceLabel(result?.source_type, domain) };
    if (existing) {
      existing.sources.push(source);
      existing.evidence = [...new Set([...existing.evidence, snippet])].slice(0, 6);
      existing.related_terms = [...new Set([...existing.related_terms, ...relatedTerms])].slice(0, 12);
      existing.price = existing.price || price(evidence);
      existing.product_match ||= productMatch;
      existing.regional_match = existing.regional_match === true || regional === true ? true : existing.regional_match;
      existing.trust_score = Math.max(existing.trust_score, trust.score);
    } else grouped.set(domain, { name: inferName(title, domain), type: inferType(evidence), product: text(requestedQuery, 180), related_terms: relatedTerms, location: regional === true ? 'Brasil/América do Sul (evidência pública)' : null, site: parsed.toString(), evidence: [snippet], sources: [source], price: price(evidence), product_match: productMatch, regional_match: regional, trust_score: trust.score, trust_evidence: title || domain, retrieved_at: result?.retrieved_at || retrievedAt });
  }
  return [...grouped.values()].map((candidate) => {
    const sourceCount = candidate.sources.length;
    const official = candidate.sources.some((source: any) => source.source_type === 'manufacturer_official');
    const compatibility = candidate.product_match ? 25 : 0;
    const evidenceScore = Math.min(30, sourceCount * 10);
    const regionalScore = candidate.regional_match === true ? 15 : candidate.regional_match === false ? 0 : 5;
    const score = Math.round(Math.min(100, 30 * candidate.trust_score + compatibility + evidenceScore + regionalScore));
    const qualified = (official && candidate.product_match && candidate.regional_match === true) || (sourceCount >= 2 && candidate.product_match && candidate.regional_match !== false && score >= 60);
    const state: SupplierState = qualified ? 'QUALIFICADO' : sourceCount > 1 || candidate.product_match ? 'EM_ANALISE' : 'DESCOBERTO';
    const risks = [];
    if (!official) risks.push('Não há fonte oficial identificada.');
    if (!candidate.price) risks.push('Preço não encontrado na fonte consultada.');
    if (candidate.regional_match !== true) risks.push('Aplicação/localização regional ainda precisa de confirmação.');
    if (!candidate.product_match) risks.push('Compatibilidade com o produto não foi demonstrada no trecho encontrado.');
    return { ...candidate, state, score, confidence: score >= 75 ? 'ALTA' : score >= 50 ? 'MÉDIA' : 'BAIXA', risk_level: risks.length >= 3 ? 'ALTO' : risks.length ? 'MODERADO' : 'NÃO AVALIADO', risks, source_count: sourceCount, price_source: candidate.price ? candidate.sources.find((source: any) => source.evidence.includes(candidate.price.source_text))?.url || candidate.sources[0].url : null };
  }).sort((a, b) => b.score - a.score).slice(0, 20);
}

export function safeSupplierPayload(candidate: any) {
  const first = Array.isArray(candidate?.sources) ? candidate.sources[0] : null;
  const sourceUrl = url(first?.url || candidate?.site);
  if (!sourceUrl || !text(candidate?.name, 180)) return null;
  return { name: text(candidate.name, 180), email: null, phone: null, source_url: sourceUrl.toString(), source_summary: text(candidate.evidence?.[0], 600), metadata: { discovered: true, state: candidate.state, product: text(candidate.product, 180), score: Number(candidate.score) || 0, sources: (candidate.sources || []).slice(0, 10) } };
}
