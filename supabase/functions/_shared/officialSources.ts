import { JohnDeereAdapter } from './adapters/johnDeere.ts';
import { ManufacturerAdapterRegistry } from './manufacturerAdapterRegistry.ts';

export type OfficialSourceResult = {
  manufacturer: string;
  source: string;
  results: unknown[];
  confidence: 'high' | 'medium' | 'low';
  retrieved_at: string;
  code?: string;
};

export function isJohnDeereContext(input: { manufacturer?: string; segment?: string; text?: string; productText?: string }) {
  return JohnDeereAdapter.matches({ manufacturer: input.manufacturer, text: input.text, product_text: input.productText });
}

export const JohnDeereOfficialSource = Object.freeze({
  name: 'JohnDeereOfficialSource',
  manufacturer: 'John Deere',
  domains: JohnDeereAdapter.official_domains,
  adapter: JohnDeereAdapter,
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
  manufacturerAdapters: ManufacturerAdapterRegistry,
});

export function selectOfficialSources(input: { manufacturer?: string; segment?: string; text?: string; productText?: string }) {
  return isJohnDeereContext(input) ? [JohnDeereOfficialSource] : [];
}
