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
  console.log('getPaymentClasses called with:', payment, groups);
  if (!payment || !payment.dateFrom || !Array.isArray(payment.groups)) return [];
  console.log('getPaymentClasses');

  const [dd, mm, yyyy] = payment.dateFrom.split('.').map(Number);
  const paymentStart = new Date(yyyy, mm - 1, dd);

  let validPast = [];

  // 1. Fetch all valid past classes for all groups
    for (const groupId of payment.groups) {
    const group = groups.find(g => g.id === groupId);
    if (!group) continue;
    const pastSnap = await getDocs(collection(db, `groups/${groupId}/pastClasses`));
    console.log('GROUP', groupId, 'pastClasses:', pastSnap.docs.length);
    for (const doc of pastSnap.docs) {
      const d = doc.data();
      console.log('doc.data() for group', groupId, ':', d);
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

// (You can now add more payment-related functions here!)

/**
 * Returns an array of students signed up for the given class (groupId+date).
 * - Only the student's lastPaymentId is considered
 * - Only if last payment is active, for the group, and covers the class date (using getPaymentClasses)
 * - Returns [{ student, payment, amount, absent }]
 * 
 * @param {Object} params
 * @param {String} groupId
 * @param {String} date (format: DD.MM.YYYY)
 * @param {Array} students
 * @param {Array} payments
 * @param {Array} groups
 * @param {Object} db
 * @param {Object} absences - (studentId: { date: [groupId, ...] })
 * @returns {Promise<Array<{id, name, amount, absent}>>}
 */
export async function getClassSignedStudents({ groupId, date, students, payments, groups, db, absences, user }) {
  const matched = [];
  const studentLastPaymentMap = {};

  students.forEach(s => {
    if (!s.lastPaymentId) return;
    const payment = payments.find(p => p.id === s.lastPaymentId);
    if (payment && payment.status === 'active' && Array.isArray(payment.groups)) {
      studentLastPaymentMap[s.id] = payment;
    }
  });

  for (const student of students) {
    const payment = studentLastPaymentMap[student.id];
    if (payment && payment.groups.includes(groupId)) {
      const paymentClasses = await getPaymentClasses({ payment, groups, db });
      const foundClass = paymentClasses.find(
        c => c.groupId === groupId && c.date === date
      );
      if (foundClass) {
        const isAbsent = absences?.[student.id]?.[date]?.includes(groupId);
        const amount = user?.role === 'coach'
          ? 1
          : payment.amount / payment.type;

        matched.push({
          id: student.id,
          name: student.name,
          amount: amount.toFixed(2),
          absent: isAbsent,
        });
      }
    }
  }

  return matched;
}