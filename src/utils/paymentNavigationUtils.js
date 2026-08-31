export function getPaymentDetailPath(payment) {
  if (!payment?.studentId || !payment?.id) return '';

  if (payment.paymentKind === 'project' && payment.projectId) {
    return `/project/${encodeURIComponent(payment.projectId)}?paymentId=${encodeURIComponent(payment.id)}`;
  }
  if (payment.paymentKind === 'workshop' && payment.workshopId) {
    return `/workshop/${encodeURIComponent(payment.workshopId)}?paymentId=${encodeURIComponent(payment.id)}`;
  }

  const paymentKey = payment.paymentKind === 'other'
    ? 'otherPaymentId'
    : 'paymentId';

  return `/student/${encodeURIComponent(payment.studentId)}?${paymentKey}=${encodeURIComponent(payment.id)}`;
}
