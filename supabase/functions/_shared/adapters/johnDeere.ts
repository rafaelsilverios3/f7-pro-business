export type ManufacturerEvidence = { title?: string; snippet?: string; url?: string; domain?: string; source_type?: string };

function normalized(value: unknown) {
  return String(value || '').toLocaleLowerCase('pt-BR');
}

export const JohnDeereAdapter = Object.freeze({
  name: 'JohnDeereAdapter',
  manufacturer: 'John Deere',
  specialist_domain: 'agricultural_parts',
  aliases: ['john deere', 'deere'],
  official_domains: ['partscatalog.deere.com', 'shop.deere.com', 'deere.com', 'digitalparts.deere.com'],
  vocabulary: ['model', 'pin', 'serial', 'engine serial', 'part number', 'assembly', 'subassembly', 'primary', 'final', 'water separator', 'position', 'side', 'serial range'],
  prompt_guidance: 'Para equipamentos John Deere, diferencie modelo, PIN, serial, serial do motor, conjunto, subconjunto, posição, lado e faixa de serial. Preserve diferenças entre filtro primário, filtro final, elemento e separador de água.',
  matches(input: { manufacturer?: string; text?: string; product_text?: string; evidence?: ManufacturerEvidence[] }) {
    const direct = normalized(`${input.manufacturer || ''} ${input.text || ''} ${input.product_text || ''}`);
    const evidence = (input.evidence || []).map((item) => normalized(`${item.title || ''} ${item.snippet || ''} ${item.domain || ''}`)).join(' ');
    return this.aliases.some((alias) => direct.includes(alias) || evidence.includes(alias));
  },
  resolveMachineIdentity(input: { model?: string; evidence?: ManufacturerEvidence[] }) {
    const evidence = input.evidence || [];
    if (!this.matches({ evidence })) return null;
    const combined = evidence.map((item) => `${item.title || ''} ${item.snippet || ''}`).join(' ');
    const equipment = /\b(tractor|trator|harvester|colheitadeira|combine|sprayer|pulverizador|planter|plantadeira|platform|plataforma|implement|implemento|agricultural engine|motor agr[ií]cola)\b/i.exec(combined)?.[1] || null;
    const sources = evidence.filter((item) => this.official_domains.some((domain) => item.domain === domain || item.domain?.endsWith(`.${domain}`))).map((item) => item.url).filter(Boolean).slice(0, 5);
    return { manufacturer: this.manufacturer, equipment_type: equipment, model: String(input.model || '').trim() || null, confidence: sources.length ? 'HIGH' as const : 'MEDIUM' as const, sources, provenance: sources.length ? 'official_source' as const : 'public_web' as const };
  },
  buildOfficialQueries(input: { model?: string; part_description?: string; old_part_number?: string; country?: string; market?: string; region?: string; locale?: string }) {
    const model = String(input.model || '').trim();
    const part = String(input.part_description || '').trim();
    const oldPart = String(input.old_part_number || '').trim();
    if (!model && !oldPart) return [];
    const southAmerica = input.region === 'south_america' || input.country === 'BR' || input.market === 'brazil' || /^pt[-_]br$/i.test(input.locale || '');
    const northAmerica = input.region === 'north_america' || input.country === 'US' || input.market === 'united_states' || /^en[-_]us$/i.test(input.locale || '');
    const regionalTerms = southAmerica ? 'South America Brazil' : northAmerica ? 'North America United States' : '';
    return [
      model && part ? `site:${this.official_domains[0]} ${model} ${part} ${regionalTerms}`.trim() : '',
      model && part ? `site:${this.official_domains[1]} ${model} ${part} part number ${regionalTerms}`.trim() : '',
      oldPart ? `site:${this.official_domains[2]} ${oldPart} replacement` : '',
    ].filter(Boolean);
  },
});
