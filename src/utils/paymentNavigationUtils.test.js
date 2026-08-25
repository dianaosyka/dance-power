import { getPaymentDetailPath } from './paymentNavigationUtils';

describe('getPaymentDetailPath', () => {
  test('links a group payment to the exact payment on the student page', () => {
    expect(getPaymentDetailPath({ id: 'group payment', studentId: 'student/1', paymentKind: 'group' }))
      .toBe('/student/student%2F1?paymentId=group%20payment');
  });

  test('links an other payment to the separate other-payment record', () => {
    expect(getPaymentDetailPath({ id: 'other-1', studentId: 'student-1', paymentKind: 'other' }))
      .toBe('/student/student-1?otherPaymentId=other-1');
  });
});
