export const SUPPLIER_OFFER_SOURCE_TYPES = Object.freeze([
  'manual',
  'supplier_intelligence',
  'csv',
  'xml',
  'api',
]);

export const SUPPLIER_OFFER_STATUS_LABELS = Object.freeze({
  draft: 'Rascunho',
  pending_verification: 'A verificar',
  verified: 'Verificada',
  approved: 'Aprovada',
  suspended: 'Suspensa',
  expired: 'Expirada',
});

const optionalNumber = (value, label, { integer = false } = {}) => {
  if (value === '' || value === null || value === undefined) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || (integer && !Number.isInteger(parsed))) {
    throw new Error(`${label} deve ser ${integer ? 'um número inteiro' : 'um número'} igual ou maior que zero.`);
  }
  return parsed;
};

export function prepareSupplierOfferInput(form) {
  const supplierId = String(form?.supplier_id || '').trim();
  const productId = String(form?.product_id || '').trim();
  if (!supplierId || !productId) throw new Error('Selecione o fornecedor e o produto do catálogo.');

  const unitCost = Number(form?.unit_cost);
  if (!Number.isFinite(unitCost) || unitCost < 0) throw new Error('Informe um custo unitário válido.');

  const currency = String(form?.currency || 'BRL').trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) throw new Error('Use um código de moeda com três letras, como BRL ou USD.');

  const minimumOrderQuantity = Number(form?.minimum_order_quantity ?? 1);
  if (!Number.isFinite(minimumOrderQuantity) || minimumOrderQuantity <= 0) {
    throw new Error('O pedido mínimo deve ser maior que zero.');
  }

  const sourceType = String(form?.source_type || 'manual');
  if (!SUPPLIER_OFFER_SOURCE_TYPES.includes(sourceType)) throw new Error('Selecione uma origem válida.');

  const observedAt = String(form?.observed_at || '');
  const validUntil = String(form?.valid_until || '') || null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(observedAt)) throw new Error('Informe a data em que o fornecedor forneceu esta informação.');
  if (validUntil && !/^\d{4}-\d{2}-\d{2}$/.test(validUntil)) throw new Error('A validade da oferta está inválida.');
  if (validUntil && validUntil < observedAt) throw new Error('A validade não pode anteceder a data da informação.');

  const sourceUrl = String(form?.source_url || '').trim() || null;
  if (sourceUrl) {
    let parsedUrl;
    try { parsedUrl = new URL(sourceUrl); } catch { throw new Error('A referência da origem não é uma URL válida.'); }
    if (parsedUrl.protocol !== 'https:' || parsedUrl.username || parsedUrl.password || parsedUrl.search || parsedUrl.hash || sourceUrl.length > 2048) {
      throw new Error('Use uma URL HTTPS sem credenciais, parâmetros ou fragmentos, com até 2.048 caracteres.');
    }
  }

  const sourceNote = String(form?.source_note || '').trim() || null;
  if (sourceNote && sourceNote.length > 1000) throw new Error('A observação da origem deve ter até 1.000 caracteres.');

  return {
    supplier_id: supplierId,
    product_id: productId,
    unit_cost: unitCost,
    currency,
    supplier_quantity: optionalNumber(form?.supplier_quantity, 'Quantidade informada pelo fornecedor'),
    minimum_order_quantity: minimumOrderQuantity,
    lead_time_days: optionalNumber(form?.lead_time_days, 'Prazo de fornecimento', { integer: true }),
    source_type: sourceType,
    source_url: sourceUrl,
    source_note: sourceNote,
    observed_at: observedAt,
    valid_until: validUntil,
  };
}

export function getSupplierOfferDisplayStatus(offer, today = new Date().toISOString().slice(0, 10)) {
  if (offer?.status !== 'expired' && offer?.valid_until && offer.valid_until < today) return 'expired';
  return offer?.status || 'draft';
}

export function compareSupplierOffers(offers = []) {
  const groups = new Map();
  for (const offer of offers) {
    const key = `${offer.product_id || ''}:${offer.currency || ''}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(offer);
  }
  return [...groups.entries()].map(([key, rows]) => ({ key, currency: rows[0]?.currency || '', offers: [...rows] }));
}
