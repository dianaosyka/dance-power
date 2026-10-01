import {
  canMarkSalaryPaid,
  canCoachChangeSalaryStatus,
  getSalaryMonthDocumentId,
  getSalaryStatusLabel,
  SALARY_STATUS,
} from './salaryWorkflow';

describe('salary workflow', () => {
  test('uses the requested European month id', () => {
    expect(getSalaryMonthDocumentId('2026-01')).toBe('01.2026');
  });

  test('only an approved salary can be marked paid', () => {
    expect(canMarkSalaryPaid(SALARY_STATUS.PENDING)).toBe(false);
    expect(canMarkSalaryPaid(SALARY_STATUS.NEEDS_REVIEW)).toBe(false);
    expect(canMarkSalaryPaid(SALARY_STATUS.APPROVED)).toBe(true);
    expect(canMarkSalaryPaid(SALARY_STATUS.PAID)).toBe(false);
  });

  test('has a safe label for a record without status', () => {
    expect(getSalaryStatusLabel()).toBe('Waiting for coach');
  });

  test('coach confirmation is final, while a reported problem can be resolved', () => {
    expect(canCoachChangeSalaryStatus(SALARY_STATUS.PENDING)).toBe(true);
    expect(canCoachChangeSalaryStatus(SALARY_STATUS.NEEDS_REVIEW)).toBe(true);
    expect(canCoachChangeSalaryStatus(SALARY_STATUS.APPROVED)).toBe(false);
    expect(canCoachChangeSalaryStatus(SALARY_STATUS.PAID)).toBe(false);
  });
});
