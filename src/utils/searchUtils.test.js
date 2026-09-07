import { includesSearchText, normalizeSearchText } from './searchUtils';

describe('searchUtils', () => {
  it('normalizes case and diacritics', () => {
    expect(normalizeSearchText('Ľuboš Šimčík')).toBe('lubos simcik');
  });

  it('matches when either side uses diacritics', () => {
    expect(includesSearchText('Žofia Nováková', 'zofia novakova')).toBe(true);
    expect(includesSearchText('Zofia Novakova', 'Žofia')).toBe(true);
  });
});
