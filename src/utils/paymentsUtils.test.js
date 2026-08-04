import { isClassUpcoming } from './paymentsUtils';

describe('isClassUpcoming', () => {
  it('keeps a class later today upcoming', () => {
    const now = new Date(2026, 7, 4, 17, 30);

    expect(isClassUpcoming('04.08.2026', '18:00', now)).toBe(true);
  });

  it('does not mark a class earlier today as upcoming', () => {
    const now = new Date(2026, 7, 4, 18, 30);

    expect(isClassUpcoming('04.08.2026', '18:00', now)).toBe(false);
  });

  it('reads the start time from a time range', () => {
    const now = new Date(2026, 7, 4, 17, 30);

    expect(isClassUpcoming('04.08.2026', '18:00 - 19:00', now)).toBe(true);
  });
});
