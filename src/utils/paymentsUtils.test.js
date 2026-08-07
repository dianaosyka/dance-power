import { getPaymentClasses, isClassUpcoming } from './paymentsUtils';

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
  it('delegates cache freshness to the shared loader across calculations', async () => {
    const fetchPastClassDocs = jest.fn().mockResolvedValue([
      {
        id: '04.08.2026',
        data: () => ({ date: '04.08.2026', canceled: false }),
      },
    ]);
    let cachedDocs;
    const loadPastClassDocs = jest.fn(async () => {
      if (!cachedDocs) cachedDocs = await fetchPastClassDocs();
      return cachedDocs;
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
      pastClassesByGroup: new Map(),
      loadPastClassDocs,
    };

    const firstResult = await getPaymentClasses(params);
    const secondResult = await getPaymentClasses(params);

    expect(firstResult).toEqual(secondResult);
    expect(loadPastClassDocs).toHaveBeenCalledTimes(2);
    expect(fetchPastClassDocs).toHaveBeenCalledTimes(1);
  });

  it('coalesces concurrent cold reads for the same group', async () => {
    let resolveDocs;
    const loadPastClassDocs = jest.fn().mockReturnValue(new Promise(resolve => {
      resolveDocs = resolve;
    }));

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
      pastClassesByGroup: new Map(),
      loadPastClassDocs,
    };

    const firstResult = getPaymentClasses(params);
    const secondResult = getPaymentClasses(params);

    expect(loadPastClassDocs).toHaveBeenCalledTimes(1);
    resolveDocs([
      {
        id: '04.08.2026',
        data: () => ({ date: '04.08.2026', canceled: false }),
      },
    ]);

    await expect(firstResult).resolves.toEqual(await secondResult);
    expect(loadPastClassDocs).toHaveBeenCalledTimes(1);
  });
});
