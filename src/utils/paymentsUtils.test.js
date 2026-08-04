import { getPaymentClasses, isClassUpcoming } from './paymentsUtils';
import { getDocs } from 'firebase/firestore';

jest.mock('firebase/firestore', () => ({
  collection: jest.fn((db, path) => ({ db, path })),
  getDocs: jest.fn(),
}));

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

describe('getPaymentClasses caching', () => {
  beforeEach(() => {
    getDocs.mockReset();
  });

  it('reuses a supplied group-history cache across calculations', async () => {
    getDocs.mockResolvedValue({
      docs: [{
        id: '04.08.2026',
        data: () => ({ date: '04.08.2026', canceled: false }),
      }],
    });

    const params = {
      payment: {
        dateFrom: '01.08.2026',
        groups: ['group-1'],
        type: 1,
      },
      groups: [{
        id: 'group-1',
        name: 'Tuesday class',
        dayOfWeek: 2,
        time: '18:00',
      }],
      db: {},
      pastClassesByGroup: new Map(),
    };

    const firstResult = await getPaymentClasses(params);
    const secondResult = await getPaymentClasses(params);

    expect(firstResult).toEqual(secondResult);
    expect(getDocs).toHaveBeenCalledTimes(1);
  });
});
