const COACH_IBANS_BY_NAME = new Map([
  ['kristina martinu', 'SK78 5600 0000 0095 5636 7001'],
  ['katarina kupcikova', 'SK08 1100 0000 0029 3431 0597'],
  ['uliana pavlenko', 'SK52 1100 0000 0029 3868 2371'],
  ['pavlenko uliana', 'SK52 1100 0000 0029 3868 2371'],
  ['sofiia kosiachenko', 'SK92 1100 0000 0029 3795 2114'],
  ['kosiachenko sofiia', 'SK92 1100 0000 0029 3795 2114'],
  ['natalia sinkova', 'SK15 0900 0000 0051 6726 3550'],
]);

function normalizeCoachName(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function formatIban(value) {
  const compact = String(value || '').replace(/\s+/g, '').toUpperCase();
  if (!compact) return '';
  return compact.match(/.{1,4}/g)?.join(' ') || compact;
}

export function getCoachIban(coach) {
  if (coach?.role === 'admin') return '';
  const savedIban = formatIban(coach?.iban);
  if (savedIban) return savedIban;
  return COACH_IBANS_BY_NAME.get(normalizeCoachName(coach?.name)) || '';
}
