import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const config = JSON.parse(await readFile(new URL('../vercel.json', import.meta.url), 'utf8'));
const appSource = await readFile(new URL('../src/App.jsx', import.meta.url), 'utf8');
const publicSite = await readFile(new URL('../src/pages/PublicSite.jsx', import.meta.url), 'utf8');

test('legacy Food entry permanently canonicalizes without leaving the Business domain', () => {
  assert.deepEqual(config.redirects.slice(0, 2), [
    { source: '/f7food', destination: '/f7-food', permanent: true },
    { source: '/f7food/:path*', destination: '/f7-food/:path*', permanent: true },
  ]);
});

test('Food assets and app routes are proxied before the Business SPA fallback', () => {
  const foodRoutes = config.rewrites.slice(0, 4);
  assert.deepEqual(foodRoutes.map((route) => route.source), [
    '/f7-food/assets/:path*',
    '/f7-food/',
    '/f7-food',
    '/f7-food/:path*',
  ]);
  assert.equal(foodRoutes[0].destination, 'https://f7-food.vercel.app/assets/:path*');
  assert.equal(foodRoutes[1].destination, 'https://f7-food.vercel.app/f7-food');
  assert.equal(foodRoutes[3].destination, 'https://f7-food.vercel.app/f7-food/:path*');
  assert.equal(config.rewrites.at(-1).destination, '/index.html');
});

test('systems catalog opens the Food commercial presentation and preserves direct operational entry', () => {
  assert.match(publicSite, /const foodAppUrl = '\/f7-food\/\?view=operation';/);
  assert.match(publicSite, /const foodSalesUrl = '\/f7-food\/planos';/);
  assert.match(publicSite, /name: 'F7 Food',[^\n]*href: foodAppUrl[^\n]*contractHref: foodSalesUrl/);
  assert.match(publicSite, /contractHref: proProductCheckoutUrl/);
  assert.match(publicSite, /function FoodEntry\(\) \{[\s\S]*?window\.location\.replace\(foodAppUrl\)/);
  assert.match(appSource, /'\/f7food': 'food-entry'/);
});

test('public plans keep PRO billing separate from assisted Food evaluation', () => {
  const plansSection = publicSite.match(/function PlansSection\([\s\S]*?\nfunction Flow/)?.[0] || '';
  const publicPlans = publicSite.match(/function Plans\(\) \{[\s\S]*?\n\}/)?.[0] || '';
  assert.match(plansSection, /commercialCodes\.has\(String\(plan\.code\)\.toLowerCase\(\)\)/);
  assert.match(plansSection, /Planos F7 PRO Business/);
  assert.match(plansSection, /\/checkout\?plan=\$\{encodeURIComponent\(plan\.code\)\}/);
  assert.match(publicPlans, /id="food-plans-heading"/);
  assert.match(publicPlans, /proposta e a habilitação comercial são assistidas/i);
  assert.match(publicPlans, /Os planos e preços do F7 PRO Business não se aplicam ao F7 Food/);
  assert.match(publicPlans, /to=\{foodSalesUrl\}/);
  assert.match(publicPlans, /to=\{foodAppUrl\}/);
  assert.doesNotMatch(publicPlans, /price_minor|\/checkout\?plan=/);
});
