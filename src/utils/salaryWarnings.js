import { SALARY_STATUS } from './salaryWorkflow';

const SALARY_WARNING_START = Object.freeze({ year: 2026, monthIndex: 8 });

export function getClosedSalaryMonths(now = new Date()) {
  const currentMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const cursor = new Date(
    SALARY_WARNING_START.year,
    SALARY_WARNING_START.monthIndex,
    1
  );
  const months = [];

  while (cursor < currentMonth) {
    const year = cursor.getFullYear();
    const month = String(cursor.getMonth() + 1).padStart(2, '0');
    months.push({
      monthValue: `${year}-${month}`,
      documentId: `${month}.${year}`,
    });
    cursor.setMonth(cursor.getMonth() + 1);
  }

  return months;
}

export function isCoachSalaryResolved(record) {
  return record?.status === SALARY_STATUS.APPROVED
    || record?.status === SALARY_STATUS.PAID;
}

export function isAdminSalaryResolved(records) {
  return records.length > 0
    && records.every(record => record.status === SALARY_STATUS.PAID);
}

