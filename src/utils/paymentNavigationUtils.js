export function getPaymentDetailPath(payment) {
  if (!payment?.studentId || !payment?.id) return '';

  const paymentKey = payment.paymentKind === 'other'
    ? 'otherPaymentId'
    : 'paymentId';

  return `/student/${encodeURIComponent(payment.studentId)}?${paymentKey}=${encodeURIComponent(payment.id)}`;
}
