export const PROJECT_PAYMENT_PARTS = {
  FULL: 'full',
  FIRST_HALF: 'first_half',
  SECOND_HALF: 'second_half',
};

export const PROJECT_PAYMENT_PART_LABELS = {
  [PROJECT_PAYMENT_PARTS.FULL]: 'Full payment (100%)',
  [PROJECT_PAYMENT_PARTS.FIRST_HALF]: 'First payment (50%)',
  [PROJECT_PAYMENT_PARTS.SECOND_HALF]: 'Second payment (50%)',
};

export function getProjectPaymentDocId(studentId, paymentPart) {
  if (!studentId || !PROJECT_PAYMENT_PART_LABELS[paymentPart]) return '';
  return `${studentId}--${paymentPart}`;
}

export function getProjectPaymentAmount(projectPrice, paymentPart) {
  const price = Number(String(projectPrice ?? '').replace(',', '.'));
  if (!Number.isFinite(price) || price <= 0) return null;

  const totalCents = Math.round(price * 100);
  if (paymentPart === PROJECT_PAYMENT_PARTS.FULL) return totalCents / 100;
  if (paymentPart === PROJECT_PAYMENT_PARTS.FIRST_HALF) {
    return Math.ceil(totalCents / 2) / 100;
  }
  if (paymentPart === PROJECT_PAYMENT_PARTS.SECOND_HALF) {
    return Math.floor(totalCents / 2) / 100;
  }
  return null;
}

export function getProjectPaymentsForStudent(payments, studentId) {
  return (Array.isArray(payments) ? payments : []).filter(payment => (
    payment?.status === 'active' &&
    (payment.studentId || payment.id) === studentId
  ));
}

export function getAvailableProjectPaymentParts(payments, studentId) {
  const studentPayments = getProjectPaymentsForStudent(payments, studentId);
  if (studentPayments.length === 0) {
    return [PROJECT_PAYMENT_PARTS.FULL, PROJECT_PAYMENT_PARTS.FIRST_HALF];
  }

  // Payments created before installment support had no part and represented
  // the whole project price.
  if (studentPayments.some(payment => !payment.paymentPart)) return [];

  const paidParts = new Set(studentPayments.map(payment => payment.paymentPart));
  if (paidParts.has(PROJECT_PAYMENT_PARTS.FULL)) return [];
  if (
    paidParts.has(PROJECT_PAYMENT_PARTS.FIRST_HALF) &&
    paidParts.has(PROJECT_PAYMENT_PARTS.SECOND_HALF)
  ) return [];
  if (paidParts.has(PROJECT_PAYMENT_PARTS.FIRST_HALF)) {
    return [PROJECT_PAYMENT_PARTS.SECOND_HALF];
  }
  if (paidParts.has(PROJECT_PAYMENT_PARTS.SECOND_HALF)) {
    return [PROJECT_PAYMENT_PARTS.FIRST_HALF];
  }

  return [PROJECT_PAYMENT_PARTS.FULL, PROJECT_PAYMENT_PARTS.FIRST_HALF];
}

export function getProjectPaymentProgress(payments, studentId, projectPrice) {
  const studentPayments = getProjectPaymentsForStudent(payments, studentId);
  const paidAmount = studentPayments.reduce((sum, payment) => {
    const amount = Number(payment.amount);
    return sum + (Number.isFinite(amount) ? amount : 0);
  }, 0);
  const price = Number(projectPrice);
  const parts = new Set(studentPayments.map(payment => payment.paymentPart));
  const legacyFull = studentPayments.some(payment => !payment.paymentPart);
  const complete = legacyFull || parts.has(PROJECT_PAYMENT_PARTS.FULL) || (
    parts.has(PROJECT_PAYMENT_PARTS.FIRST_HALF) &&
    parts.has(PROJECT_PAYMENT_PARTS.SECOND_HALF)
  );

  return {
    paidAmount,
    remainingAmount: Number.isFinite(price) ? Math.max(0, price - paidAmount) : 0,
    complete,
    hasPayment: studentPayments.length > 0,
    payments: studentPayments,
  };
}
