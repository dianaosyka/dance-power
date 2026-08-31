import { getCoachPayForClass, getCoachRatePerPerson } from './coachSalaryUtils';
import { generateProjectSchedule, parseLocalIsoDate } from './projectUtils';

export function isProjectSessionStarted(session, now = new Date()) {
  const sessionDate = parseLocalIsoDate(session?.isoDate);
  if (!sessionDate || !(now instanceof Date) || Number.isNaN(now.getTime())) return false;

  const timeMatch = String(session?.time || '').match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  if (timeMatch) {
    sessionDate.setHours(Number(timeMatch[1]), Number(timeMatch[2]), 0, 0);
  } else {
    sessionDate.setHours(23, 59, 59, 999);
  }

  return sessionDate <= now;
}

export function getUniqueActiveProjectPayments(payments) {
  const paymentsByStudent = new Map();

  (Array.isArray(payments) ? payments : []).forEach(payment => {
    if (!payment || payment.status !== 'active') return;
    const studentId = payment.studentId || payment.id;
    if (!studentId || paymentsByStudent.has(studentId)) return;
    paymentsByStudent.set(studentId, payment);
  });

  return [...paymentsByStudent.values()];
}

export function getRevenueProjectPayments(payments) {
  const activeByStudent = new Map();
  (Array.isArray(payments) ? payments : []).forEach(payment => {
    if (!payment || payment.status !== 'active') return;
    const studentId = payment.studentId || payment.id;
    if (!studentId) return;
    const current = activeByStudent.get(studentId) || [];
    current.push(payment);
    activeByStudent.set(studentId, current);
  });

  return [...activeByStudent.values()].flatMap(studentPayments => {
    const legacy = studentPayments.find(payment => !payment.paymentPart);
    if (legacy) return [legacy];
    const full = studentPayments.find(payment => payment.paymentPart === 'full');
    if (full) return [full];

    const first = studentPayments.find(payment => payment.paymentPart === 'first_half');
    const second = studentPayments.find(payment => payment.paymentPart === 'second_half');
    return [first, second].filter(Boolean);
  });
}

export function hasProjectSessionsForSalaryMonth(
  project,
  monthValue,
  now = new Date()
) {
  if (!/^\d{4}-\d{2}$/.test(String(monthValue || ''))) return false;
  return generateProjectSchedule(project).some(session => (
    session.isoDate.startsWith(`${monthValue}-`) &&
    isProjectSessionStarted(session, now)
  ));
}

export function getProjectSalaryClasses({
  project,
  payments,
  monthValue,
  now = new Date(),
}) {
  const schedule = generateProjectSchedule(project);
  if (!schedule.length || !/^\d{4}-\d{2}$/.test(String(monthValue || ''))) return [];

  const paidStudents = getUniqueActiveProjectPayments(payments);
  const revenuePayments = getRevenueProjectPayments(payments);
  const studentCount = paidStudents.length;
  const totalPayments = revenuePayments.reduce((sum, payment) => {
    const amount = Number(payment.amount);
    return sum + (Number.isFinite(amount) ? amount : 0);
  }, 0);
  const gross = totalPayments / schedule.length;
  const permanentProject = { ...project, type: 'permanent' };

  return schedule
    .filter(session => session.isoDate.startsWith(`${monthValue}-`))
    .filter(session => isProjectSessionStarted(session, now))
    .map(session => ({
      ...session,
      studentCount,
      gross,
      coachRate: getCoachRatePerPerson(permanentProject, session.date, studentCount),
      coachPay: getCoachPayForClass(permanentProject, session.date, studentCount),
    }));
}
