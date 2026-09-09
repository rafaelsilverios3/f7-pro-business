export type AgriculturalCandidate = {
  part_number?: string;
  model?: string | null;
  description?: string | null;
  system?: string | null;
  position?: string | null;
  serial_range?: string | null;
  application?: string | null;
  source_type?: string;
  evidence_count?: number;
  is_official?: boolean;
  trust_score?: number;
  confidence?: number;
  score?: number;
};

function normalized(value: unknown) {
  return String(value || '').toLocaleLowerCase('pt-BR');
}

function includes(haystack: unknown, needle: unknown) {
  const wanted = normalized(needle).trim();
  return Boolean(wanted && normalized(haystack).includes(wanted));
}

export const AgriculturalPartsSpecialist = Object.freeze({
  name: 'AgriculturalPartsSpecialist',
  domain: 'agricultural_parts',
  supported_equipment: ['tractor', 'sugarcane_harvester', 'combine', 'sprayer', 'planter', 'platform', 'implement', 'agricultural_engine'],
  matches(input: { segment?: string; business_description?: string; text?: string }) {
    return /agr[ií]col|trator|colheit|pulverizador|plantadeira|plataforma|implemento|motor agr[ií]cola/i.test(`${input.segment || ''} ${input.business_description || ''} ${input.text || ''}`);
  },
  researchCanStart(input: { model?: string; part_description?: string }) {
    return Boolean(String(input.model || '').trim() && String(input.part_description || '').trim());
  },
  confirmationFields() {
    return ['serial_or_chassis', 'application_location', 'system_or_assembly', 'side_or_position', 'engraved_part_number'];
  },
  rankCandidate(candidate: AgriculturalCandidate, input: { model?: string; system?: string; position?: string; serial?: string; part_description?: string }) {
    const text = `${candidate.description || ''} ${candidate.application || ''}`;
    let score = Number(candidate.score || 0);
    if (candidate.is_official || candidate.source_type === 'manufacturer_official') score += 100;
    if (includes(`${candidate.model || ''} ${text}`, input.model)) score += 45;
    if (includes(`${candidate.system || ''} ${text}`, input.system)) score += 30;
    if (includes(`${candidate.position || ''} ${text}`, input.position)) score += 20;
    if (input.serial && candidate.serial_range && includes(candidate.serial_range, input.serial)) score += 18;
    score += Math.min(25, Math.max(0, Number(candidate.evidence_count || 0) - 1) * 7);
    score += Math.round(Math.max(0, Math.min(1, Number(candidate.trust_score || 0))) * 20);
    if (includes(text, input.part_description)) score += 25;
    return score;
  },
  nextBestQuestion(candidates: AgriculturalCandidate[]) {
    if (candidates.length <= 1) return null;
    const values = (field: keyof AgriculturalCandidate) => new Set(candidates.map((candidate) => String(candidate[field] || '').trim()).filter(Boolean));
    if (values('serial_range').size > 1) return 'serial_or_pin';
    if (values('system').size > 1) return 'system_or_assembly';
    if (values('position').size > 1) return 'side_or_position';
    return 'engraved_part_number_or_photo';
  },
  prompt_guidance: 'Comece a pesquisa com modelo e descrição da peça. Apresente candidatos relevantes antes de pedir confirmação. Use PIN/chassi, serial, conjunto, posição, lado, PN antigo ou foto somente para resolver variantes restantes. Nunca invente PN ou compatibilidade.',
});
