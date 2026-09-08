export type OfficialSourceResult = {
  manufacturer: string;
  source: string;
  results: unknown[];
  confidence: 'high' | 'medium' | 'low';
  retrieved_at: string;
  code?: string;
};

function normalized(value: unknown) {
  return String(value || '').toLocaleLowerCase('pt-BR');
}

export function isJohnDeereContext(input: { manufacturer?: string; segment?: string; text?: string; productText?: string }) {
  // A generic agricultural segment is not enough: the adapter is selected
  // only when the manufacturer/product/question explicitly identifies Deere.
  const directContext = [input.manufacturer, input.text, input.productText].map(normalized).join(' ');
  return /john\s*deere|deere/.test(directContext);
}

export const JohnDeereOfficialSource = Object.freeze({
  name: 'JohnDeereOfficialSource',
  manufacturer: 'John Deere',
  domains: ['partscatalog.deere.com', 'deere.com'],
  async searchOfficialSource(_input: Record<string, unknown>): Promise<OfficialSourceResult> {
    // No undocumented endpoint or scraping is assumed. A future adapter can
    // add an official API here without changing the assistant contract.
    return {
      manufacturer: 'John Deere',
      source: 'https://partscatalog.deere.com',
      results: [],
      confidence: 'low',
      retrieved_at: new Date().toISOString(),
      code: 'OFFICIAL_SOURCE_UNAVAILABLE',
    };
  },
});

export const CompanyInternalSource = Object.freeze({ name: 'CompanyInternalSource', type: 'internal_catalog' });
export const ManufacturerOfficialSource = Object.freeze({ name: 'ManufacturerOfficialSource', type: 'manufacturer_official' });
export const SegmentSpecificSource = Object.freeze({ name: 'SegmentSpecificSource', type: 'segment_specific' });

export const OfficialSourcesRegistry = Object.freeze({
  JohnDeereOfficialSource,
  ManufacturerOfficialSource,
  CompanyInternalSource,
  SegmentSpecificSource,
});

export function selectOfficialSources(input: { manufacturer?: string; segment?: string; text?: string; productText?: string }) {
  return isJohnDeereContext(input) ? [JohnDeereOfficialSource] : [];
}
