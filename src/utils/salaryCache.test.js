import { invalidateSalarySummaries } from './salaryCache';

describe('salary cache invalidation', () => {
  beforeEach(() => localStorage.clear());

  test('marks salary summaries outdated without deleting their calculated values', () => {
    localStorage.setItem('salarySummary:v8:admin:a:2026-08', JSON.stringify({
      generatedAt: 123,
      earnedTotal: 456,
      classRows: [{ id: 'class-1' }],
    }));
    localStorage.setItem('unrelated', 'keep');

    invalidateSalarySummaries();

    const saved = JSON.parse(localStorage.getItem('salarySummary:v8:admin:a:2026-08'));
    expect(saved).toMatchObject({
      generatedAt: 123,
      earnedTotal: 456,
      classRows: [{ id: 'class-1' }],
    });
    expect(saved.invalidatedAt).toEqual(expect.any(Number));
    expect(localStorage.getItem('unrelated')).toBe('keep');
  });
});
