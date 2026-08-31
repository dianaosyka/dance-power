import {
  getAvailableProjectPaymentParts,
  getProjectPaymentAmount,
  getProjectPaymentDocId,
  getProjectPaymentProgress,
  PROJECT_PAYMENT_PARTS,
} from './projectPaymentUtils';

describe('project installment payments', () => {
  it('offers full or first half initially, then only the second half', () => {
    expect(getAvailableProjectPaymentParts([], 'student-1')).toEqual([
      PROJECT_PAYMENT_PARTS.FULL,
      PROJECT_PAYMENT_PARTS.FIRST_HALF,
    ]);
    expect(getAvailableProjectPaymentParts([{
      id: 'first',
      studentId: 'student-1',
      status: 'active',
      paymentPart: PROJECT_PAYMENT_PARTS.FIRST_HALF,
    }], 'student-1')).toEqual([PROJECT_PAYMENT_PARTS.SECOND_HALF]);
  });

  it('closes payment after full or both halves and keeps deterministic ids', () => {
    expect(getAvailableProjectPaymentParts([{
      studentId: 'student-1', status: 'active', paymentPart: 'full',
    }], 'student-1')).toEqual([]);
    expect(getAvailableProjectPaymentParts([
      { studentId: 'student-1', status: 'active', paymentPart: 'first_half' },
      { studentId: 'student-1', status: 'active', paymentPart: 'second_half' },
    ], 'student-1')).toEqual([]);
    expect(getProjectPaymentDocId('student-1', 'second_half'))
      .toBe('student-1--second_half');
  });

  it('splits odd-cent prices without losing money', () => {
    expect(getProjectPaymentAmount(99.99, 'first_half')).toBe(50);
    expect(getProjectPaymentAmount(99.99, 'second_half')).toBe(49.99);
    expect(getProjectPaymentAmount(99.99, 'full')).toBe(99.99);
  });

  it('summarizes partial and complete progress', () => {
    const first = {
      studentId: 'student-1', status: 'active', paymentPart: 'first_half', amount: 50,
    };
    expect(getProjectPaymentProgress([first], 'student-1', 100)).toMatchObject({
      paidAmount: 50,
      remainingAmount: 50,
      complete: false,
      hasPayment: true,
    });
    expect(getProjectPaymentProgress([
      first,
      { studentId: 'student-1', status: 'active', paymentPart: 'second_half', amount: 50 },
    ], 'student-1', 100)).toMatchObject({ complete: true, remainingAmount: 0 });
  });
});
