import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const config = JSON.parse(await readFile(new URL('../vercel.json', import.meta.url), 'utf8'));
const appSource = await readFile(new URL('../src/App.jsx', import.meta.url), 'utf8');
const publicSite = await readFile(new URL('../src/pages/PublicSite.jsx', import.meta.url), 'utf8');
const productCatalog = await readFile(new URL('../src/config/publicProductCatalog.js', import.meta.url), 'utf8');

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
  assert.match(productCatalog, /key: 'f7_food'[\s\S]*?accessPath: '\/f7-food\/\?view=operation'[\s\S]*?plansPath: '\/f7-food\/planos'[\s\S]*?commercialModel: 'assisted'/);
  assert.match(productCatalog, /key: 'f7_pro_business'[\s\S]*?plansPath: '\/planos\/f7-pro-business'[\s\S]*?commercialModel: 'catalog'[\s\S]*?planCodes: \['pro', 'business', 'premium'\]/);
  assert.match(publicSite, /productKey === 'f7_food' \? 'Planos e contratação' : 'Conhecer planos e contratação'/);
  assert.match(publicSite, /function FoodEntry\(\) \{[\s\S]*?window\.location\.replace\(foodProduct\.accessPath\)/);
  assert.match(appSource, /'\/f7food': 'food-entry'/);
  assert.match(appSource, /'\/planos\/f7-pro-business': 'pro-plans'/);
});

test('root plans page is a multiproduct chooser and Food never uses PRO prices or checkout', () => {
  assert.match(publicSite, /Escolha o seu produto F7 Business\./);
  assert.match(publicSite, /Planos PRO, BUSINESS e PREMIUM/);
  assert.match(publicSite, /\/checkout\?plan=\$\{encodeURIComponent\(plan\.code\)\}/);
  assert.match(publicSite, /foodProduct\.offerStages\.map/);
  assert.match(productCatalog, /name: 'Avaliação'/);
  assert.match(productCatalog, /name: 'Implantação assistida'/);
  assert.match(productCatalog, /name: 'Proposta comercial'/);
  assert.match(publicSite, /O Food utiliza licenciamento independente/);
  assert.match(publicSite, /function ProPlans\(\)/);
  assert.match(publicSite, /Ver detalhes e comparação dos planos/);
  assert.doesNotMatch(publicSite.match(/function Plans\(\)[\s\S]*?\n\}/)?.[0] || '', /\/checkout\?plan=/);
});
