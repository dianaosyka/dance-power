import { formatIban, getCoachIban } from './coachIban';

describe('coach IBAN helpers', () => {
  it.each([
    ['Kristína Martinů', 'SK78 5600 0000 0095 5636 7001'],
    ['Katarína Kupčíková', 'SK08 1100 0000 0029 3431 0597'],
    ['Uliana Pavlenko', 'SK52 1100 0000 0029 3868 2371'],
    ['Pavlenko Uliana', 'SK52 1100 0000 0029 3868 2371'],
    ['Kosiachenko Sofiia', 'SK92 1100 0000 0029 3795 2114'],
    ['Natalia Sinkova', 'SK15 0900 0000 0051 6726 3550'],
  ])('returns the supplied IBAN for %s', (name, expectedIban) => {
    expect(getCoachIban({ name })).toBe(expectedIban);
  });

  it('prefers and formats an IBAN saved on the coach record', () => {
    expect(getCoachIban({
      name: 'Someone Else',
      iban: 'sk0011000000001234567890',
    })).toBe('SK00 1100 0000 0012 3456 7890');
  });

  it('does not show bank details for an admin account', () => {
    expect(getCoachIban({
      name: 'Diana Osyka',
      role: 'admin',
      iban: 'SK0011000000001234567890',
    })).toBe('');
  });

  it('formats compact IBAN values in groups of four', () => {
    expect(formatIban('SK0811000000002934310597'))
      .toBe('SK08 1100 0000 0029 3431 0597');
  });
});
