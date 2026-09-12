import { createRepository } from '@/data/repositoryFactory';
import { calculateSupplierScore, normalizeSupplierScores, trustLabel } from '@/lib/supplierScoring';
import { invokeEdgeFunction } from '@/services/integrationsService';
const profiles = createRepository('SupplierIntelligence');
const reviews = createRepository('SupplierReview');
const signals = createRepository('SupplierRiskSignal');
export const supplierIntelligenceService = {
  list: (companyId) => profiles.list(companyId, '-created_date'),
  reviews: (companyId, supplierId) => reviews.list(companyId, '-created_date').then((rows) => rows.filter((row) => row.supplier_id === supplierId)),
  signals: (companyId, supplierId) => signals.list(companyId, '-created_date').then((rows) => rows.filter((row) => row.supplier_id === supplierId)),
  save: async (companyId, supplierId, scores, metadata = {}) => { const normalized = normalizeSupplierScores(scores); const score = calculateSupplierScore(normalized); const confidence = Number(metadata.data_confidence || 0); const payload = { company_id: companyId, supplier_id: supplierId, reputation_score: normalized.reputation, history_score: normalized.history, price_score: normalized.price, delivery_score: normalized.delivery, returns_score: normalized.returns, complaints_score: normalized.complaints, consistency_score: normalized.consistency, supplier_score: score, trust_score: score, trust_label: trustLabel(score, confidence), data_confidence: confidence, source_summary: metadata.source_summary || '', metadata }; const existing = (await profiles.list(companyId)).find((row) => row.supplier_id === supplierId); return existing ? profiles.update(existing.id, payload, companyId) : profiles.create(payload, companyId); },
  discover: (companyId, query, options = {}) => invokeEdgeFunction('supplier-intelligence', { company_id: companyId, query, depth: options.depth === 'detailed' ? 'detailed' : 'quick', history: Array.isArray(options.history) ? options.history : [], context: options.context || {} }),
  saveDiscovered: (companyId, candidate) => invokeEdgeFunction('supplier-intelligence', { action: 'save', company_id: companyId, candidate }),
  addReview: (companyId, data) => reviews.create({ ...data, reviewed_at: data.reviewed_at || new Date().toISOString() }, companyId),
  addSignal: (companyId, data) => signals.create({ ...data, needs_validation: true, detected_at: data.detected_at || new Date().toISOString() }, companyId),
};
