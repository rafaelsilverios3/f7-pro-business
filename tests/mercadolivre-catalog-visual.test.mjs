import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildMeliListingFacets, normalizeMeliListingQuery, safeMeliCategoryName, safeMeliImageUrl, safeMeliPermalink } from '../supabase/functions/_shared/mercadolivreCatalog.js';

const read = (path) => fs.readFileSync(path, 'utf8');

test('listing images accept only real HTTPS Mercado Livre CDN URLs', () => {
  assert.equal(safeMeliImageUrl({ pictures: [{ secure_url: 'https://http2.mlstatic.com/D_123.webp' }] }), 'https://http2.mlstatic.com/D_123.webp');
  assert.equal(safeMeliImageUrl({ thumbnail: 'http://http2.mlstatic.com/D_123.jpg' }), null);
  assert.equal(safeMeliImageUrl({ thumbnail: 'https://example.com/fake.jpg' }), null);
  assert.equal(safeMeliImageUrl({ thumbnail: 'https://evilmlstatic.com/image.jpg' }), null);
  assert.equal(safeMeliImageUrl({ thumbnail: 'https://user:pass@http2.mlstatic.com/image.jpg' }), null);
  assert.equal(safeMeliImageUrl({}), null);
});

test('original listing links accept only HTTPS Mercado Livre domains', () => {
  assert.equal(safeMeliPermalink('https://produto.mercadolivre.com.br/MLB-123'), 'https://produto.mercadolivre.com.br/MLB-123');
  assert.equal(safeMeliPermalink('http://produto.mercadolivre.com.br/MLB-123'), null);
  assert.equal(safeMeliPermalink('https://mercadolivre.com.br.attacker.test/MLB-123'), null);
  assert.equal(safeMeliPermalink('https://attacker.test/MLB-123'), null);
});

test('category labels are real bounded values and facets count actual category and status rows', () => {
  assert.equal(safeMeliCategoryName('  Acessórios  '), 'Acessórios');
  assert.equal(safeMeliCategoryName(''), null);
  assert.equal(safeMeliCategoryName('x'.repeat(161)), null);
  const facets = buildMeliListingFacets([
    { category_id: 'MLB1', category_name: 'Acessórios', status: 'active' },
    { category_id: 'MLB1', category_name: null, status: 'active' },
    { category_id: 'MLB2', category_name: 'Casa', status: 'paused' },
    { category_id: null, category_name: null, status: null },
  ]);
  assert.equal(facets.total, 4);
  assert.deepEqual(facets.categories.map(({ category_id, count }) => [category_id, count]), [['MLB1', 2], ['MLB2', 1], [null, 1]]);
  assert.deepEqual(facets.statuses.map(({ status, count }) => [status, count]), [['active', 2], ['paused', 1], ['unknown', 1]]);
});

test('catalog filters normalize query syntax and bound pagination and sort options', () => {
  const filters = normalizeMeliListingQuery({
    search: 'MLB-123%, (test), " <script> ', category_id: 'MLB123', status: 'active', sort: 'price_desc', page: 999999, page_size: 200,
  });
  assert.equal(filters.search.includes('%'), false);
  assert.equal(filters.search.includes(','), false);
  assert.equal(filters.search.includes('('), false);
  assert.equal(filters.categoryId, 'MLB123');
  assert.equal(filters.sort, 'price_desc');
  assert.equal(filters.page, 10_000);
  assert.equal(filters.pageSize, 48);
  assert.equal(filters.offset, 480_000);
  assert.equal(normalizeMeliListingQuery({ sort: 'price);drop table', category_id: 'MLB;drop' }).sort, 'updated_desc');
  assert.equal(normalizeMeliListingQuery({ category_id: 'MLB;drop' }).categoryId, '');
});

test('visual catalog route and requests preserve company, connection, role, and read/write boundaries', () => {
  const page = read('src/pages/MercadoLivreListings.jsx');
  const route = read('src/App.jsx');
  const api = read('supabase/functions/mercadolivre-api/index.ts');
  const connector = read('src/components/commerce/MercadoLivreConnector.jsx');
  assert.match(route, /path="\/f7-commerce\/anuncios" element={<RoleGuard permission="sales_channels\.view"><MercadoLivreListings \/><\/RoleGuard>} \/>/);
  assert.match(page, /companyMembershipGateState\(membership, company\?\.id\)/);
  assert.match(page, /mercadoLivreAction\(companyId, 'list_listings'/);
  assert.match(page, /\.eq\('company_id', companyId\)\.eq\('connection_id', connectionId\)/);
  assert.match(page, /mercadoLivreAction\(companyId, 'map_listing'/);
  assert.match(page, /canManage &&/);
  assert.match(api, /const managerActions = \['disconnect', 'map_listing', 'push_product'\]/);
  assert.match(api, /\.eq\('company_id', companyId\)\.eq\('connection_id', connectionId\)/);
  assert.match(api, /query = query\.order\(sort\[0\],[\s\S]*?\.range\(filters\.offset, filters\.offset \+ filters\.pageSize - 1\)/);
  assert.match(api, /has_more: filters\.offset \+ \(data \|\| \[\]\)\.length < total/);
  assert.match(connector, /Anúncios sincronizados/);
  assert.match(connector, /list_listings/);
  assert.doesNotMatch(connector, /Pedidos importados|Enviar preço e estoque/);
});

test('visual catalog renders real image, category, marketplace link, F7 mapping, and load-more affordance', () => {
  const page = read('src/pages/MercadoLivreListings.jsx');
  assert.match(page, /listing\.image_url/);
  assert.match(page, /listing\.category_name/);
  assert.match(page, /listing\.permalink/);
  assert.match(page, /listing\.product_id/);
  assert.match(page, /Carregar mais anúncios/);
  assert.match(page, /search, category_id: categoryId, status, sort, page, page_size: PAGE_SIZE/);
  assert.match(page, /select\('category_id,category_name,status'/);
});
