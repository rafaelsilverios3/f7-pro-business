export const normalizeSearchText = (value) => String(value ?? '').trim().toLocaleLowerCase('pt-BR');

export function searchSourceRows(rows, source, query, limit = 5) {
  const needle = normalizeSearchText(query);
  return (rows || []).filter((row) => source.fields
    .map((field) => row?.[field])
    .filter((value) => value !== null && value !== undefined)
    .join(' ')
    .toLocaleLowerCase('pt-BR')
    .includes(needle)).slice(0, limit).map((row) => ({
    id: row.id,
    type: source.key,
    category: source.label,
    route: source.route,
    title: source.title(row),
    subtitle: source.subtitle(row),
  }));
}
