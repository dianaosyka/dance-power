import {
  getClosedSalaryMonths,
  isAdminSalaryResolved,
  isCoachSalaryResolved,
} from './salaryWarnings';

describe('salary deadline warnings', () => {
  test('starts warning for September on the first of October 2026', () => {
    expect(getClosedSalaryMonths(new Date(2026, 9, 1))).toEqual([{
      monthValue: '2026-09',
      documentId: '09.2026',
    }]);
  });

  test('does not warn during September or before the feature start', () => {
    expect(getClosedSalaryMonths(new Date(2026, 8, 30))).toEqual([]);
  });

  test('coach is resolved by approval or payment', () => {
    expect(isCoachSalaryResolved({ status: 'approved' })).toBe(true);
    expect(isCoachSalaryResolved({ status: 'paid' })).toBe(true);
    expect(isCoachSalaryResolved({ status: 'needs_review' })).toBe(false);
  });

  test('admin is resolved only when every existing salary is paid', () => {
    expect(isAdminSalaryResolved([])).toBe(false);
    expect(isAdminSalaryResolved([{ status: 'paid' }])).toBe(true);
    expect(isAdminSalaryResolved([{ status: 'paid' }, { status: 'approved' }])).toBe(false);
  });
});

