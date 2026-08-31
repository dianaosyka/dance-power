import {
  getProjectSalaryClasses,
  getRevenueProjectPayments,
  getUniqueActiveProjectPayments,
  hasProjectSessionsForSalaryMonth,
  isProjectSessionStarted,
} from './projectSalaryUtils';

describe('project salary helpers', () => {
  const project = {
    startDate: '2026-09-01',
    endDate: '2026-09-30',
    totalClasses: 4,
    scheduleSlots: [
      { dayOfWeek: 2, time: '18:00' },
      { dayOfWeek: 4, time: '18:00' },
    ],
    type: 'OPEN',
  };

  const payments = [
    { id: 'student-a', studentId: 'student-a', status: 'active', amount: 100 },
    { id: 'duplicate-a', studentId: 'student-a', status: 'active', amount: 999 },
    { id: 'student-b', studentId: 'student-b', status: 'active', amount: 80 },
    { id: 'student-c', studentId: 'student-c', status: 'inactive', amount: 120 },
  ];

  it('counts each actively paid student once', () => {
    expect(getUniqueActiveProjectPayments(payments).map(payment => payment.studentId))
      .toEqual(['student-a', 'student-b']);
  });

  it('adds both installment amounts without counting the student twice', () => {
    const installments = [
      { id: 'a-first', studentId: 'a', status: 'active', paymentPart: 'first_half', amount: 50 },
      { id: 'a-second', studentId: 'a', status: 'active', paymentPart: 'second_half', amount: 50 },
    ];
    expect(getRevenueProjectPayments(installments)).toHaveLength(2);
    const rows = getProjectSalaryClasses({
      project,
      payments: installments,
      monthValue: '2026-09',
      now: new Date(2026, 8, 1, 18, 0),
    });
    expect(rows[0]).toMatchObject({ studentCount: 1, gross: 25, coachPay: 1 });
  });

  it('spreads whole-project revenue across the fixed schedule and uses permanent rates', () => {
    const rows = getProjectSalaryClasses({
      project,
      payments,
      monthValue: '2026-09',
      now: new Date(2026, 8, 8, 20, 0),
    });

    expect(rows).toHaveLength(3);
    expect(rows.map(row => row.isoDate)).toEqual([
      '2026-09-01',
      '2026-09-03',
      '2026-09-08',
    ]);
    rows.forEach(row => {
      expect(row.studentCount).toBe(2);
      expect(row.gross).toBe(45);
      expect(row.coachRate).toBe(1);
      expect(row.coachPay).toBe(2);
    });
  });

  it('does not count a same-day class before its scheduled time', () => {
    const session = { isoDate: '2026-09-01', time: '18:00' };
    expect(isProjectSessionStarted(session, new Date(2026, 8, 1, 17, 59))).toBe(false);
    expect(isProjectSessionStarted(session, new Date(2026, 8, 1, 18, 0))).toBe(true);
  });

  it('identifies whether a nested payment read is needed for the salary month', () => {
    expect(hasProjectSessionsForSalaryMonth(
      project,
      '2026-09',
      new Date(2026, 8, 1, 17, 59)
    )).toBe(false);
    expect(hasProjectSessionsForSalaryMonth(
      project,
      '2026-09',
      new Date(2026, 8, 1, 18, 0)
    )).toBe(true);
    expect(hasProjectSessionsForSalaryMonth(
      project,
      '2026-10',
      new Date(2026, 9, 31)
    )).toBe(false);
  });
});
