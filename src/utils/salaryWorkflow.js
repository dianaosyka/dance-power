export const SALARY_STATUS = Object.freeze({
  PENDING: 'pending',
  NEEDS_REVIEW: 'needs_review',
  APPROVED: 'approved',
  PAID: 'paid',
});

export function getSalaryMonthDocumentId(monthValue) {
  const [year, month] = String(monthValue || '').split('-');
  if (!year || !month) return '';
  return `${month.padStart(2, '0')}.${year}`;
}

export function getSalaryStatusLabel(status) {
  switch (status) {
    case SALARY_STATUS.NEEDS_REVIEW:
      return 'Double-check needed';
    case SALARY_STATUS.APPROVED:
      return 'Ready to pay';
    case SALARY_STATUS.PAID:
      return 'Paid';
    default:
      return 'Waiting for coach';
  }
}

export function canMarkSalaryPaid(status) {
  return status === SALARY_STATUS.APPROVED;
}

export function canCoachChangeSalaryStatus(status) {
  return status !== SALARY_STATUS.APPROVED && status !== SALARY_STATUS.PAID;
}
