import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const edge = fs.readFileSync('supabase/functions/assistant-suggest/index.ts', 'utf8');
const sources = fs.readFileSync('supabase/functions/_shared/officialSources.ts', 'utf8');
const page = fs.readFileSync('src/pages/Atendimento.jsx', 'utf8');
const permissions = fs.readFileSync('src/lib/permissions.js', 'utf8');
const service = fs.readFileSync('src/services/assistantSuggestService.js', 'utf8');
const integrations = fs.readFileSync('src/services/integrationsService.js', 'utf8');

test('assisted suggestion is gated and never auto-sends', () => {
  assert.match(edge, /mode.*assisted/);
  assert.match(edge, /AI_ENABLED.*true/);
  assert.match(edge, /company_has_feature/);
  assert.match(edge, /consume_rate_limit/);
  assert.doesNotMatch(edge, /whatsapp-send/);
  assert.match(page, /Sugerir resposta/);
  assert.match(page, /Usar resposta/);
  assert.match(page, /Gerar novamente/);
  assert.doesNotMatch(service, /graph\.facebook\.com|WHATSAPP_ACCESS_TOKEN|SERVICE_ROLE/);
});

test('assistant resolves the company server-side and keeps context scoped', () => {
  assert.match(edge, /conversation_id/);
  assert.match(edge, /company_users/);
  assert.match(edge, /company_assistant_settings/);
  assert.match(edge, /eq\('company_id', conversation\.company_id\)/);
  assert.match(edge, /specific_rules/);
  assert.match(edge, /company_quick_replies/);
  assert.match(edge, /company_handoff_rules/);
  assert.match(edge, /segmentGuidance/);
  assert.match(edge, /Para John Deere/);
  assert.match(edge, /products/);
  assert.match(edge, /media_type/);
  assert.doesNotMatch(edge, /media_url|signedUrl/);
});

test('assistant context does not require optional catalog or media columns', () => {
  assert.match(edge, /messages'\)\.select\('id,sender_type,content,message_type,created_at'/);
  assert.match(edge, /products'\)\.select\('id,name,sku,price,stock,active'/);
  assert.doesNotMatch(edge, /messages'\)\.select\('[^']*media_type/);
  assert.doesNotMatch(edge, /products'\)\.select\('[^']*(?:brand|category|subcategory|short_description)/);
});

test('context lookup isolates resources and returns a safe failing resource', () => {
  for (const resource of ['messages', 'products', 'company_quick_replies', 'company_handoff_rules']) assert.match(edge, new RegExp(`resource: '${resource}'`));
  assert.match(edge, /resource: failedResource\.resource/);
  assert.match(edge, /CONTEXT_MESSAGES_OK/);
  assert.match(edge, /CONTEXT_PRODUCTS_OK/);
});

test('multisegment official source registry selects John Deere only for related context', () => {
  assert.match(sources, /OfficialSourcesRegistry/);
  assert.match(sources, /JohnDeereOfficialSource/);
  assert.match(sources, /partscatalog\.deere\.com/);
  assert.match(sources, /isJohnDeereContext/);
  assert.match(sources, /return isJohnDeereContext\(input\) \? \[JohnDeereOfficialSource\] : \[\]/);
  assert.match(sources, /OFFICIAL_SOURCE_UNAVAILABLE/);
  assert.match(edge, /manufacturer_official/);
});

test('permission is available to supported human roles while automatic mode stays blocked', () => {
  for (const role of ['gestor', 'comercial', 'vendedor', 'atendimento']) assert.match(permissions, new RegExp(`${role}:.*assistant\\.suggest`));
  assert.match(permissions, /assistant\.suggest/);
  assert.match(page, /mode === 'assisted'/);
  assert.match(edge, /AI_ENABLED/);
});

test('provider hardening has bounded context, timeout and safe status mapping', () => {
  assert.match(edge, /AbortController/);
  assert.match(edge, /20_000/);
  assert.match(edge, /AI_PROVIDER_TIMEOUT/);
  assert.match(edge, /AI_PROVIDER_AUTH_ERROR/);
  assert.match(edge, /AI_PROVIDER_RATE_LIMITED/);
  assert.match(edge, /AI_PROVIDER_UNAVAILABLE/);
  assert.match(edge, /AI_INVALID_RESPONSE/);
  assert.match(edge, /MAX_PROVIDER_CONTEXT_CHARS/);
  assert.match(edge, /MAX_PRODUCTS_CONTEXT/);
  assert.match(edge, /MAX_QUICK_REPLIES_CONTEXT/);
  assert.match(edge, /MAX_HANDOFF_RULES_CONTEXT/);
  assert.doesNotMatch(edge, /retry|Retry/);
});

test('provider context separates trusted company data from untrusted customer text', () => {
  assert.match(edge, /COMPANY_RULES/);
  assert.match(edge, /COMPANY_CONTEXT/);
  assert.match(edge, /CUSTOMER_CONVERSATION/);
  assert.match(edge, /INTERNAL_CATALOG/);
  assert.match(edge, /OFFICIAL_SOURCES/);
  assert.match(edge, /DADO NÃO CONFIÁVEL/);
  assert.match(edge, /Never|Nunca revele/);
  assert.match(edge, /product_name/);
  assert.match(edge, /sale_price/);
  assert.match(edge, /stock_quantity/);
  assert.doesNotMatch(edge, /products_considered.*id:/);
});

test('model response is validated and observations are sanitized', () => {
  assert.match(edge, /suggestion\.length > 2000/);
  assert.match(edge, /typeof parsed\.requires_human !== 'boolean'/);
  assert.match(edge, /\['high', 'medium', 'low'\]/);
  assert.match(edge, /logObservation/);
  assert.match(edge, /duration_ms/);
  assert.match(edge, /context_message_count/);
  assert.doesNotMatch(edge, /prompt_complete|raw_body|Authorization.*metadata/);
});

test('technical missing information remains contextual and multisgment-safe', () => {
  assert.match(edge, /technicalMissingInformation/);
  for (const field of ['model', 'serial_or_chassis', 'application_location', 'system_or_assembly', 'side_or_position', 'engraved_part_number']) assert.match(edge, new RegExp(field));
  assert.match(sources, /JohnDeereOfficialSource/);
});

test('assistant diagnostics expose safe stages and a stable success/error contract', () => {
  for (const stage of ['ASSISTANT_REQUEST_RECEIVED', 'AUTH_OK', 'MEMBERSHIP_OK', 'PERMISSION_OK', 'ENTITLEMENT_OK', 'MODE_OK', 'CONTEXT_READY', 'AI_REQUEST_STARTED', 'AI_REQUEST_FINISHED', 'AI_RESPONSE_PARSED', 'ASSISTANT_SUCCESS', 'ASSISTANT_FAILED']) assert.match(edge, new RegExp(stage));
  assert.match(edge, /success: true/);
  assert.match(edge, /success: false/);
  assert.match(edge, /internal_error_code/);
  assert.match(edge, /provider_config/);
  assert.match(edge, /provider_request_id/);
  assert.doesNotMatch(edge, /AI_API_KEY.*metadata|Authorization.*integration_logs|prompt.*integration_logs/i);
});

test('assistant isolates post-context stages and sanitizes product intelligence before serialization', () => {
  for (const stage of ['CONTEXT_MESSAGES_READY', 'INTERNAL_PRODUCTS_RESOLVED', 'PRODUCT_INTELLIGENCE_INTERNAL_READY', 'WEB_RESEARCH_INPUT_READY', 'WEB_RESEARCH_READY', 'EXTERNAL_CANDIDATES_READY', 'PRODUCT_INTELLIGENCE_MERGED', 'SOURCE_METADATA_READY', 'AI_CONTEXT_READY']) assert.match(edge, new RegExp(stage));
  assert.match(edge, /normalizeCandidateForContext/);
  assert.match(edge, /Array\.isArray\(candidate\?\.supporting_sources\)/);
  assert.match(edge, /Array\.isArray\(candidate\?\.evidence\)/);
  assert.match(edge, /JSON\.stringify\(contextObject\)/);
  assert.match(edge, /AI_CONTEXT_SERIALIZATION_ERROR/);
  assert.match(edge, /error_name/);
  assert.match(edge, /error_message/);
});

test('web research input failures fall back safely and do not prevent an assistant suggestion', () => {
  assert.match(edge, /WEB_RESEARCH_INPUT_FALLBACK/);
  assert.match(edge, /technicalInput = inferTechnicalResearchInput/);
  assert.match(edge, /productIntelligence\?\.need_external_research !== false/);
  assert.match(edge, /WEB_RESEARCH_FALLBACK/);
});

test('frontend preserves provider diagnostics instead of showing an empty generic result', () => {
  assert.match(page, /Código:/);
  assert.match(page, /result\?\.success !== false/);
  for (const code of ['AI_PROVIDER_AUTH_ERROR', 'AI_PROVIDER_QUOTA_OR_RATE_LIMIT', 'AI_MODEL_NOT_AVAILABLE', 'AI_JSON_MODE_UNSUPPORTED', 'AI_PROVIDER_TIMEOUT']) assert.match(integrations, new RegExp(code));
  assert.match(integrations, /createIntegrationError/);
});

test('assisted controls use company membership and do not depend on VITE_AI_ENABLED', () => {
  assert.match(page, /useCompanyMembership/);
  assert.match(page, /assistantCanSuggest/);
  assert.match(page, /can\(\{ role: membership\.role \}, 'assistant\.suggest'\)/);
  assert.match(page, /assistantSettings\.mode === 'assisted'/);
  assert.doesNotMatch(page, /VITE_AI_ENABLED/);
  assert.match(page, /Ative o modo Assistido nas Configurações de Atendimento/);
  assert.match(page, /Gerando sugestão/);
});

test('internal assistant failures preserve safe stage and internal code in the UI', () => {
  assert.match(edge, /internal_error_code/);
  assert.match(edge, /conversation_lookup/);
  assert.match(edge, /membership_lookup/);
  assert.match(edge, /feature_lookup/);
  assert.match(edge, /rate_limit/);
  assert.match(edge, /settings_lookup/);
  assert.match(edge, /context_lookup/);
  assert.match(page, /Etapa: \$\{error\.stage\}/);
  assert.match(page, /Código interno: \$\{error\.internalCode\}/);
  assert.match(integrations, /internal_error_code/);
});

test('provider configuration and model failures remain specific', () => {
  assert.match(edge, /AI_MODEL_NOT_AVAILABLE/);
  assert.match(edge, /AI_PROVIDER_CONFIG_INVALID/);
  assert.match(edge, /AI_JSON_MODE_UNSUPPORTED/);
  assert.match(edge, /rawEndpoint !== rawEndpoint\.trim\(\)/);
  assert.match(edge, /rawModel !== rawModel\.trim\(\)/);
  assert.doesNotMatch(edge, /AI_API_KEY[^\n]*(console|metadata)/i);
});

test('OpenAI Chat Completions payload avoids unsupported sampling parameters and sanitizes provider diagnostics', () => {
  assert.match(edge, /model, messages: \[\{ role: 'system'/);
  assert.doesNotMatch(edge, /JSON\.stringify\(\{ model, temperature:/);
  assert.match(edge, /provider_param/);
  for (const code of ['invalid_request', 'unsupported_parameter', 'invalid_api_key', 'insufficient_quota', 'rate_limit_exceeded']) assert.match(edge, new RegExp(code));
  for (const code of ['AI_PROVIDER_CONFIG_INVALID', 'AI_PROVIDER_MODEL_NOT_FOUND', 'AI_PROVIDER_QUOTA_EXCEEDED', 'AI_PROVIDER_RATE_LIMITED']) assert.match(edge, new RegExp(code));
  assert.doesNotMatch(edge, /providerError\.message.*metadata|apiKey.*metadata/i);
});

test('assistant uses strict Structured Outputs JSON Schema on Chat Completions', () => {
  assert.match(edge, /ASSISTANT_RESPONSE_FORMAT/);
  assert.match(edge, /type: 'json_schema'/);
  assert.match(edge, /name: 'assistant_suggestion'/);
  assert.match(edge, /strict: true/);
  assert.match(edge, /required: \['suggestion', 'requires_human', 'confidence'\]/);
  assert.match(edge, /additionalProperties: false/);
  assert.match(edge, /AI_STRUCTURED_OUTPUT_UNSUPPORTED/);
  assert.match(integrations, /AI_STRUCTURED_OUTPUT_UNSUPPORTED/);
  assert.match(edge, /keys\.some\(\(key\) => !allowedKeys\.includes\(key\)\)/);
});

test('assistant suggestion panel follows the selected blue and indigo menu styling', () => {
  assert.match(page, /bg-gradient-to-r from-blue-600 to-indigo-600/);
  assert.match(page, /bg-\[#0b1424\].*text-white/);
  assert.doesNotMatch(page, /bg-violet-50/);
});
