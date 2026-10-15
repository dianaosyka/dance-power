import { getCoachPayForClass, getCoachRatePerPerson } from './coachSalaryUtils';

describe('coach salary attendance grid', () => {
  it.each([
    [1, 1],
    [4, 1],
    [5, 2],
    [9, 2],
    [10, 3],
    [18, 3],
  ])('uses €%s attendance bands from October for every group type', (studentCount, expectedRate) => {
    ['OPEN', 'CLOSED', 'PROJECT', 'permanent'].forEach(type => {
      expect(getCoachRatePerPerson({ type }, '01.10.2026', studentCount)).toBe(expectedRate);
      expect(getCoachPayForClass({ type }, '01.10.2026', studentCount))
        .toBe(studentCount * expectedRate);
    });
  });

  it('keeps the earlier open-class grid from July through September', () => {
    expect(getCoachRatePerPerson({ type: 'OPEN' }, '30.09.2026', 10)).toBe(3);
    expect(getCoachRatePerPerson({ type: 'CLOSED' }, '30.09.2026', 10)).toBe(1);
    expect(getCoachRatePerPerson({ type: 'PROJECT' }, '30.09.2026', 10)).toBe(1);
  });

  it('keeps the old €1-per-person rule before July', () => {
    expect(getCoachRatePerPerson({ type: 'OPEN' }, '30.06.2026', 12)).toBe(1);
    expect(getCoachRatePerPerson({ type: 'CLOSED' }, '30.06.2026', 12)).toBe(1);
  });
});
