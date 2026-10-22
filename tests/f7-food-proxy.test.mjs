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

test('systems catalog opens the Food operation from the proxied canonical address', () => {
  assert.match(publicSite, /const foodAppUrl = '\/f7-food\?view=operation';/);
  assert.match(appSource, /'\/f7food': 'food-entry'/);
});
