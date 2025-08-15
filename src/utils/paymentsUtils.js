import { collection, getDocs } from 'firebase/firestore';

// Helpers
function parseDate(dateStr) {
  const [dd, mm, yyyy] = dateStr.split('.').map(Number);
  return new Date(yyyy, mm - 1, dd);
}

function formatDate(date) {
  return (
    String(date.getDate()).padStart(2, '0') + '.' +
    String(date.getMonth() + 1).padStart(2, '0') + '.' +
    date.getFullYear()
  );
}

function* generateFutureDates(startFrom, weekday, afterDatesSet, groupId, groupName) {
  const date = new Date(startFrom);
  while (true) {
    if (date.getDay() === weekday) {
      const dStr = formatDate(date);
      if (!afterDatesSet.has(`${groupId}_${dStr}`)) {
        yield {
          date: dStr,
          groupId,
          groupName,
        };
      }
    }
    date.setDate(date.getDate() + 1);
  }
}

/**
 * Returns up to `payment.type` valid class dates (past and generated future) for all groups in this payment.
 * Skips canceled, sorts, and generates missing ones.
 */
export async function getPaymentClasses({ payment, groups, db }) {
  if (!payment || !payment.dateFrom || !Array.isArray(payment.groups)) return [];

  const [dd, mm, yyyy] = payment.dateFrom.split('.').map(Number);
  const paymentStart = new Date(yyyy, mm - 1, dd);

  let validPast = [];

  // 1. Fetch all valid past classes for all groups
    for (const groupId of payment.groups) {
    const group = groups.find(g => g.id === groupId);
    if (!group) continue;
    const pastSnap = await getDocs(collection(db, `groups/${groupId}/pastClasses`));
    for (const doc of pastSnap.docs) {
      const d = doc.data();
      if (d.canceled) continue;
      if (!d.date) continue;
      const classDate = parseDate(d.date);
      if (classDate < paymentStart) continue;
      validPast.push({
        date: d.date,
        groupId,
        groupName: group.name,
      });
    }
  }


  // 2. Sort by date ascending
  validPast.sort((a, b) => parseDate(a.date) - parseDate(b.date));

  // 3. If enough, return first N
  if (validPast.length >= payment.type) return validPast.slice(0, payment.type);

  // 4. If not enough, fill with generated future classes
  const classesNeeded = payment.type - validPast.length;
  const afterDatesSet = new Set(validPast.map(cls => `${cls.groupId}_${cls.date}`));
  let nextDates = [];
  const futureGenerators = payment.groups.map(groupId => {
    const group = groups.find(g => g.id === groupId);
    if (!group) return null;
    return {
      groupId,
      groupName: group.name,
      gen: generateFutureDates(new Date(), group.dayOfWeek, afterDatesSet, groupId, group.name),
      lastDate: null
    };
  }).filter(Boolean);

  // Initialize nextDates with the first from each generator
  for (const genObj of futureGenerators) {
    const next = genObj.gen.next();
    if (!next.done) {
      genObj.lastDate = next.value;
      nextDates.push(genObj);
    }
  }

  while (validPast.length < payment.type && nextDates.length > 0) {
    // Find the earliest date across all nextDates
    let nextIdx = 0;
    for (let i = 1; i < nextDates.length; i++) {
      if (parseDate(nextDates[i].lastDate.date) < parseDate(nextDates[nextIdx].lastDate.date)) {
        nextIdx = i;
      }
    }
    const chosen = nextDates[nextIdx].lastDate;
    validPast.push(chosen);
    afterDatesSet.add(`${chosen.groupId}_${chosen.date}`);

    // Advance this generator to its next available date
    const next = nextDates[nextIdx].gen.next();
    if (!next.done) {
      nextDates[nextIdx].lastDate = next.value;
    } else {
      nextDates.splice(nextIdx, 1);
    }
  }

  return validPast.slice(0, payment.type);
}

/**
 * Returns an array of students (via payments) signed up for the given class (groupId+date).
 * - Iterates over ALL payments (not just student's lastPaymentId)
 * - Only payments that are active, include the group, and cover the class date (using getPaymentClasses)
 * - Returns [{ id, name, amount, absent }]
 *
 * @param {Object} params
 * @param {String} params.groupId
 * @param {String} params.date            // format: DD.MM.YYYY
 * @param {Array}  params.students        // [{id, name, lastPaymentId, groups, ...}]
 * @param {Array}  params.payments        // [{id, studentId?, status, groups, amount, type, ...}]
 * @param {Array}  params.groups
 * @param {Object} params.db
 * @param {Object} params.absences        // (studentId: { [date]: [groupId, ...] })
 * @param {Object} params.user            // {role: 'coach' | ...}
 * @returns {Promise<Array<{id: string, name: string, amount: string, absent: boolean}>>}
 */
export async function getClassSignedStudentsByPayments({
  groupId,
  date,
  students,
  payments,
  groups,
  db,
  absences,
  user,
}) {
  const result = [];

  // Quick lookup for students by id
  const studentsById = new Map(students.map(s => [s.id, s]));

  // Fallback: map paymentId -> student if payment.studentId is missing
  // (uses lastPaymentId heuristic)
  const studentByLastPaymentId = new Map(
    students
      .filter(s => s.lastPaymentId)
      .map(s => [s.lastPaymentId, s])
  );

  // Filter only relevant payments for this group & active
  const candidatePayments = payments.filter(p =>
    p &&
    p.status === 'active' &&
    Array.isArray(p.groups) &&
    p.groups.includes(groupId)
  );

  for (const payment of candidatePayments) {
    // Resolve student for this payment
    let student =
      (payment.studentId && studentsById.get(payment.studentId)) ||
      studentByLastPaymentId.get(payment.id) ||
      null;

    if (!student) continue; // Can't attribute this payment to a student

    // Optional: ensure the student is (or was) part of the group
    // If you don't want this check, remove the next 4 lines.
    if (!Array.isArray(student.groups) || !student.groups.includes(groupId)) {
      // If the business logic says payment->group is enough, skip this check
      // and allow attendance purely by payment coverage.
      // continue;
    }

    // Does this payment cover the class?
    const paymentClasses = await getPaymentClasses({ payment, groups, db });
    const coversClass = paymentClasses?.some(
      c => c.groupId === groupId && c.date === date
    );
    if (!coversClass) continue;

    const isAbsent = !!absences?.[student.id]?.[date]?.includes(groupId);
    const amount = user?.role === 'coach' ? 1 : (payment.amount / payment.type);

    result.push({
      id: student.id,
      name: student.name,
      amount: Number.isFinite(amount) ? amount.toFixed(2) : '0.00',
      absent: isAbsent,
    });
  }

  return result;
}