const OPEN_GROUP_SALARY_START = new Date(2026, 6, 1);
const ALL_GROUP_SALARY_START = new Date(2026, 9, 1);

function parseClassDate(dateStr) {
  const [dd, mm, yyyy] = String(dateStr || '').split('.').map(Number);
  return new Date(yyyy, mm - 1, dd);
}

export function getCoachRatePerPerson(group, date, studentCount) {
  const classDate = parseClassDate(date);
  const usesAttendanceGrid =
    classDate >= ALL_GROUP_SALARY_START ||
    (
      String(group?.type || '').toLowerCase() === 'open' &&
      classDate >= OPEN_GROUP_SALARY_START
    );

  if (!usesAttendanceGrid) return 1;
  if (studentCount >= 10) return 3;
  if (studentCount >= 5) return 2;
  return 1;
}

export function getCoachPayForClass(group, date, studentCount) {
  return studentCount * getCoachRatePerPerson(group, date, studentCount);
}
