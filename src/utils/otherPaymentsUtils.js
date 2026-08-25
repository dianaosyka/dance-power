export const OTHER_PAYMENT_REASONS = [
  { value: 'hall_rent', label: 'Hall rent' },
  { value: 'private_lessons', label: 'Private lessons' },
  { value: 'workshops', label: 'Workshops' },
];

export function formatEuropeanDate(dateValue) {
  const [year, month, day] = String(dateValue || '').split('-');
  if (!year || !month || !day) return '';
  return `${day}.${month}.${year}`;
}

export function getOtherPaymentMonth(dateFrom) {
  const [, month, year] = String(dateFrom || '').split('.');
  if (!month || !year) return '';
  return `${month.padStart(2, '0')}.${year}`;
}

export function getEuropeanMonthFromMonthValue(monthValue) {
  const [year, month] = String(monthValue || '').split('-');
  if (!year || !month) return '';
  return `${month.padStart(2, '0')}.${year}`;
}

export function getOtherPaymentReasonLabel(reason) {
  return OTHER_PAYMENT_REASONS.find(option => option.value === reason)?.label
    || reason
    || 'Unknown';
}

export function getOtherPaymentsFromMonthDocument(monthDocument) {
  if (!monthDocument) return [];

  const data = typeof monthDocument.data === 'function'
    ? monthDocument.data()
    : monthDocument.data || monthDocument;
  const month = data?.month || monthDocument.id || '';
  const payments = data?.payments;
  if (!payments || typeof payments !== 'object' || Array.isArray(payments)) return [];

  return Object.entries(payments)
    .filter(([, payment]) => payment && typeof payment === 'object')
    .map(([id, payment]) => ({
      id,
      month,
      ...payment,
    }));
}

export function getOtherPaymentsFromMonthDocuments(monthDocuments) {
  return (monthDocuments || []).flatMap(getOtherPaymentsFromMonthDocument);
}

export function getOtherPaymentsForMonth(otherPayments, monthValue) {
  const expectedMonth = getEuropeanMonthFromMonthValue(monthValue);
  if (!expectedMonth) return [];
  return (otherPayments || []).filter(payment => {
    const amount = Number(payment?.amount);
    return payment?.status === 'active'
      && getOtherPaymentMonth(payment.dateFrom) === expectedMonth
      && Number.isFinite(amount);
  });
}

export function getOtherPaymentsTotal(otherPayments, monthValue) {
  return getOtherPaymentsForMonth(otherPayments, monthValue)
    .reduce((total, payment) => total + Number(payment.amount), 0);
}
