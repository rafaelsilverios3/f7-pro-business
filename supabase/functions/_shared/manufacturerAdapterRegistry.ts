import { JohnDeereAdapter, type ManufacturerEvidence } from './adapters/johnDeere.ts';

export type ManufacturerAdapter = typeof JohnDeereAdapter;

const adapters: ManufacturerAdapter[] = [JohnDeereAdapter];

export const ManufacturerAdapterRegistry = Object.freeze({
  all: () => adapters.slice(),
  select(input: { manufacturer?: string; text?: string; product_text?: string; evidence?: ManufacturerEvidence[] }) {
    return adapters.find((adapter) => adapter.matches(input)) || null;
  },
  domains(manufacturer?: string) {
    return this.select({ manufacturer })?.official_domains.slice() || [];
  },
  resolveMachineIdentity(input: { model?: string; evidence?: ManufacturerEvidence[] }) {
    for (const adapter of adapters) {
      const identity = adapter.resolveMachineIdentity(input);
      if (identity) return identity;
    }
    return null;
  },
});

