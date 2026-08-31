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

  test('links a project payment back to its project', () => {
    expect(getPaymentDetailPath({
      id: 'student-1--first_half',
      studentId: 'student-1',
      projectId: 'project/1',
      paymentKind: 'project',
    })).toBe('/project/project%2F1?paymentId=student-1--first_half');
  });

  test('links a workshop payment back to its workshop', () => {
    expect(getPaymentDetailPath({ id: 'student-1', studentId: 'student-1', workshopId: 'w1', paymentKind: 'workshop' }))
      .toBe('/workshop/w1?paymentId=student-1');
  });
});
