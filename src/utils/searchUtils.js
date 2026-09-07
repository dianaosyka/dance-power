export function normalizeSearchText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase();
}

export function includesSearchText(value, searchTerm) {
  return normalizeSearchText(value).includes(normalizeSearchText(searchTerm));
}
