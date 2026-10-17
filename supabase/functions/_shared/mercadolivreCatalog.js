const IMAGE_HOSTS = ['mlstatic.com'];
const LISTING_HOSTS = ['mercadolivre.com.br', 'mercadolibre.com'];

export function safeMeliImageUrl(item) {
  const pictures = Array.isArray(item?.pictures) ? item.pictures : [];
  const candidates = [
    ...pictures.flatMap((picture) => [picture?.secure_url, picture?.url]),
    item?.secure_thumbnail,
    item?.thumbnail,
  ];

  for (const candidate of candidates) {
    if (typeof candidate !== 'string' || candidate.length > 2_000) continue;
    try {
      const url = new URL(candidate);
      if (url.protocol !== 'https:' || url.username || url.password) continue;
      if (!IMAGE_HOSTS.some((domain) => url.hostname === domain || url.hostname.endsWith(`.${domain}`))) continue;
      return url.toString();
    } catch {
      // Skip malformed provider image URLs; no placeholder or guessed image is stored.
    }
  }
  return null;
}

export function safeMeliCategoryName(value) {
  if (typeof value !== 'string') return null;
  const name = value.trim();
  return name.length > 0 && name.length <= 160 ? name : null;
}

export function safeMeliPermalink(value) {
  if (typeof value !== 'string' || value.length > 2_000) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password) return null;
    if (!LISTING_HOSTS.some((domain) => url.hostname === domain || url.hostname.endsWith(`.${domain}`))) return null;
    return url.toString();
  } catch { return null; }
}

export function normalizeMeliListingQuery(input = {}) {
  const rawSearch = typeof input.search === 'string' ? input.search.normalize('NFKC') : '';
  const search = rawSearch.replace(/[^\p{L}\p{N}\s._-]/gu, '').trim().slice(0, 80);
  const rawCategory = String(input.category_id || '').trim();
  const categoryId = /^[A-Z0-9_-]{1,40}$/.test(rawCategory) ? rawCategory : '';
  const rawStatus = String(input.status || '').trim().toLowerCase();
  const status = /^[a-z][a-z0-9_-]{0,39}$/.test(rawStatus) ? rawStatus : '';
  const allowedSorts = new Set(['updated_desc', 'updated_asc', 'price_asc', 'price_desc', 'title_asc', 'title_desc']);
  const sort = allowedSorts.has(input.sort) ? input.sort : 'updated_desc';
  const pageNumber = Number(input.page);
  const page = Number.isSafeInteger(pageNumber) && pageNumber >= 0 ? Math.min(pageNumber, 10_000) : 0;
  const pageSizeNumber = Number(input.page_size);
  const pageSize = Number.isSafeInteger(pageSizeNumber) && pageSizeNumber > 0 ? Math.min(pageSizeNumber, 48) : 24;
  return { search, categoryId, status, sort, page, pageSize, offset: page * pageSize };
}

export function buildMeliListingFacets(rows = []) {
  const categories = new Map();
  const statuses = new Map();
  for (const row of rows) {
    const categoryId = typeof row?.category_id === 'string' && row.category_id ? row.category_id : null;
    const categoryName = safeMeliCategoryName(row?.category_name);
    const key = categoryId || '__uncategorized__';
    const previous = categories.get(key) || { category_id: categoryId, category_name: categoryName, count: 0 };
    if (!previous.category_name && categoryName) previous.category_name = categoryName;
    previous.count += 1;
    categories.set(key, previous);
    const status = typeof row?.status === 'string' && row.status ? row.status : 'unknown';
    statuses.set(status, (statuses.get(status) || 0) + 1);
  }
  return {
    total: rows.length,
    categories: [...categories.values()].sort((a, b) => (a.category_name || a.category_id || 'zz').localeCompare(b.category_name || b.category_id || 'zz', 'pt-BR')),
    statuses: [...statuses.entries()].map(([status, count]) => ({ status, count })).sort((a, b) => a.status.localeCompare(b.status)),
  };
}
