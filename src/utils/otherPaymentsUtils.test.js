import {
  formatEuropeanDate,
  getOtherPaymentMonth,
  getEuropeanMonthFromMonthValue,
  getOtherPaymentReasonLabel,
  getOtherPaymentsFromMonthDocument,
  getOtherPaymentsForMonth,
  getOtherPaymentsTotal,
} from './otherPaymentsUtils';

describe('other payment helpers', () => {
  it('formats dates and their month in European format', () => {
    expect(formatEuropeanDate('2026-08-09')).toBe('09.08.2026');
    expect(getOtherPaymentMonth('09.08.2026')).toBe('08.2026');
    expect(getEuropeanMonthFromMonthValue('2026-08')).toBe('08.2026');
  });

  it('provides readable reason labels', () => {
    expect(getOtherPaymentReasonLabel('hall_rent')).toBe('Hall rent');
    expect(getOtherPaymentReasonLabel('private_lessons')).toBe('Private lessons');
    expect(getOtherPaymentReasonLabel('workshops')).toBe('Workshops');
  });

  it('flattens payments stored in a monthly document', () => {
    const payments = getOtherPaymentsFromMonthDocument({
      id: '08.2026',
      data: () => ({
        payments: {
          paymentA: { studentId: 'student-1', amount: 20 },
          paymentB: { studentId: 'student-2', amount: 35 },
        },
      }),
    });

    expect(payments).toEqual([
      { id: 'paymentA', month: '08.2026', studentId: 'student-1', amount: 20 },
      { id: 'paymentB', month: '08.2026', studentId: 'student-2', amount: 35 },
    ]);
  });

  it('selects active payments by date from and totals their amounts', () => {
    const payments = [
      { id: '1', status: 'active', amount: 20, dateFrom: '02.08.2026' },
      { id: '2', status: 'active', amount: '35.50', dateFrom: '31.08.2026' },
      { id: '3', status: 'active', amount: 10, dateFrom: '01.09.2026' },
      { id: '4', status: 'inactive', amount: 100, dateFrom: '15.08.2026' },
    ];

    expect(getOtherPaymentsForMonth(payments, '2026-08').map(payment => payment.id))
      .toEqual(['1', '2']);
    expect(getOtherPaymentsTotal(payments, '2026-08')).toBe(55.5);
  });
});
