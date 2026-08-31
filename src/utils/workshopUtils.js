export function getWorkshopMonth(date) {
  const match = String(date || '').match(/^(\d{4})-(\d{2})-\d{2}$/);
  return match ? `${match[1]}-${match[2]}` : '';
}

export function getWorkshopSalary({ workshop, payments, monthValue }) {
  if (!workshop || getWorkshopMonth(workshop.date) !== monthValue) return null;
  const activePayments = (payments || []).filter(payment => payment?.status === 'active');
  const gross = activePayments.reduce((sum, payment) => {
    const amount = Number(payment.amount);
    return sum + (Number.isFinite(amount) ? amount : 0);
  }, 0);
  const coachIds = [...new Set((workshop.coaches || []).filter(Boolean))];
  const totalCoachRate = coachIds.length === 1 ? 0.3 : coachIds.length >= 2 ? 0.4 : 0;
  const coachPayEach = coachIds.length ? gross * totalCoachRate / coachIds.length : 0;
  return {
    gross,
    coachIds,
    coachPayEach,
    coachesTotal: coachPayEach * coachIds.length,
    ownerEarned: gross - coachPayEach * coachIds.length,
    studentCount: new Set(activePayments.map(payment => payment.studentId).filter(Boolean)).size,
  };
}
