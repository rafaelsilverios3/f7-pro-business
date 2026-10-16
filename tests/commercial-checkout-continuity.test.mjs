import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(path, 'utf8');
const provider = read('src/auth/providers/supabaseAuthProvider.js');
const register = read('src/pages/Register.jsx');
const login = read('src/pages/Login.jsx');
const onboarding = read('src/pages/Onboarding.jsx');
const companyContext = read('src/contexts/CompanyContext.jsx');
const checkout = read('src/pages/Checkout.jsx');
const checkoutFunction = read('supabase/functions/billing-checkout/index.ts');
const billingService = read('src/services/billingService.js');
const billingHealthPage = read('src/pages/SubscriptionBilling.jsx');

test('Supabase email confirmation returns to login with the validated original destination', () => {
  assert.match(provider, /emailRedirectTo/);
  assert.match(register, /emailConfirmationRedirect\(window\.location\.origin, safeReturnTo\(\)\)/);
  assert.match(register, /Confirme o e-mail pelo link enviado/);
  assert.match(login, /if \(isAuthenticated\) navigate\(returnTo, \{ replace: true \}\)/);
});

test('company creation navigates directly to the sanitized return target and blocks duplicate submits', () => {
  assert.match(onboarding, /createCompanyLock\.current/);
  assert.match(onboarding, /await createCompany\(companyName\);\s*navigate\(safeReturnTo\(\), \{ replace: true \}\)/);
  assert.match(companyContext, /createCompanyInFlight/);
  assert.match(companyContext, /create_company_with_owner/);
  assert.match(companyContext, /setCompany\(created\)/);
});

test('checkout leaves tenant authorization on the server and recurring payment disabled', () => {
  assert.match(checkout, /const recurringBillingEnabled = false/);
  assert.match(checkoutFunction, /auth\.getUser\(jwt\)/);
  assert.match(checkoutFunction, /company_users/);
  assert.match(checkoutFunction, /!member\?\.active \|\| !\['admin', 'gestor'\]\.includes\(member\.role\)/);
  assert.match(checkoutFunction, /p_company_id: companyId/);
});

test('Supabase catalog failure is explicit instead of silently displaying fallback plans', () => {
  assert.match(billingService, /if \(error\) throw planCatalogUnavailable\(\)/);
  assert.match(billingService, /return buildActivePlanCatalog\(data \|\| \[\], featureResult\.data \|\| \[\]\)/);
  assert.match(billingService, /if \(import\.meta\.env\.VITE_DATA_PROVIDER !== 'supabase'\) return FALLBACK_PLANS/);
  assert.match(billingHealthPage, /endpoint de diagnóstico do provedor não está publicado/);
});
