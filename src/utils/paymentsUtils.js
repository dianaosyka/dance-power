// Request registries are scoped to the shared cache Map. DataProvider replaces
// that Map when the signed-in user changes, so an old request can only populate
// its orphaned cache and can never leak into the next user's session.
const pastClassRequestsByCache = new WeakMap();

// Helpers
function parseDate(dateStr) {
  const [dd, mm, yyyy] = dateStr.split('.').map(Number);
  return new Date(yyyy, mm - 1, dd);
}

function parseTimeToMinutes(timeStr) {
  if (!timeStr || typeof timeStr !== 'string') return 23 * 60 + 59;
  const match = timeStr.match(/(\d{1,2}):(\d{2})/);
  if (!match) return 23 * 60 + 59;
  return Number(match[1]) * 60 + Number(match[2]);
}

export function isClassUpcoming(dateStr, timeStr, now = new Date()) {
  const classDate = parseDate(dateStr);
  const timeMatch = typeof timeStr === 'string'
    ? timeStr.match(/(\d{1,2}):(\d{2})/)
    : null;

  if (timeMatch) {
    classDate.setHours(Number(timeMatch[1]), Number(timeMatch[2]), 0, 0);
  }

  return classDate > now;
}

function formatDate(date) {
  return (
    String(date.getDate()).padStart(2, '0') + '.' +
    String(date.getMonth() + 1).padStart(2, '0') + '.' +
    date.getFullYear()
  );
}

function* generateFutureDates(
  startFrom,
  weekday,
  afterDatesSet,
  groupId,
  groupName,
  groupTime,
  startTime,
  startBoundaryDate
) {
  const date = new Date(startFrom);
  while (true) {
    if (date.getDay() === weekday) {
      const dStr = formatDate(date);
      const isBeforeStartTime =
        startTime &&
        formatDate(date) === formatDate(startBoundaryDate) &&
        parseTimeToMinutes(groupTime) < parseTimeToMinutes(startTime);

      if (!isBeforeStartTime && !afterDatesSet.has(`${groupId}_${dStr}`)) {
        yield {
          date: dStr,
          groupId,
          groupName,
          groupTime,
        };
      }
    }
    date.setDate(date.getDate() + 1);
  }
}

/**
 * Returns up to `payment.type` valid class dates (past and generated future) for all groups in this payment.
 * Skips canceled, sorts by date + time, and generates missing ones.
 */
async function getPastClassDocs({ groupId, pastClassesByGroup, loadPastClassDocs }) {
  if (typeof loadPastClassDocs !== 'function') {
    if (pastClassesByGroup?.has(groupId)) {
      return pastClassesByGroup.get(groupId);
    }
    throw new Error('A shared past-class loader is required.');
  }

  // Always enter through the provider loader. It owns TTL/freshness decisions;
  // returning the Map entry directly here would make a once-loaded class
  // history live forever and bypass deletion reconciliation.
  if (!pastClassesByGroup) {
    return loadPastClassDocs(groupId);
  }
  let requests = pastClassRequestsByCache.get(pastClassesByGroup);
  if (!requests) {
    requests = new Map();
    pastClassRequestsByCache.set(pastClassesByGroup, requests);
  }
  let request = requests.get(groupId);
  if (!request) {
    request = loadPastClassDocs(groupId)
      .then(docs => {
        pastClassesByGroup?.set(groupId, docs);
        return docs;
      })
      .finally(() => requests.delete(groupId));
    requests.set(groupId, request);
  }

  return request;
}

export async function getPaymentClasses({
  payment,
  groups,
  pastClassesByGroup,
  loadPastClassDocs,
}) {
  if (!payment || !payment.dateFrom || !Array.isArray(payment.groups)) return [];

  const [dd, mm, yyyy] = payment.dateFrom.split('.').map(Number);
  const paymentStart = new Date(yyyy, mm - 1, dd);
  const paymentStartTime = payment.timeFrom || '';

  let validPast = [];

  // 1. Fetch all valid past classes for all groups
  for (const groupId of payment.groups) {
    const group = groups.find(g => g.id === groupId);
    if (!group) continue;

    const pastClassDocs = await getPastClassDocs({
      groupId,
      pastClassesByGroup,
      loadPastClassDocs,
    });
    for (const pastClassDoc of pastClassDocs) {
      const d = pastClassDoc.data();
      if (d.canceled) continue;
      if (!d.date) continue;

      const classDate = parseDate(d.date);
      if (classDate < paymentStart) continue;

      const groupTime = group.time || group.schedule || '';
      if (
        paymentStartTime &&
        classDate.getTime() === paymentStart.getTime() &&
        parseTimeToMinutes(groupTime) < parseTimeToMinutes(paymentStartTime)
      ) continue;

      validPast.push({
        date: d.date,
        groupId,
        groupName: group.name,
        groupTime,
      });
    }
  }

  // 2. Sort by date ascending, then by time ascending
  validPast.sort((a, b) => {
    const dateDiff = parseDate(a.date) - parseDate(b.date);
    if (dateDiff !== 0) return dateDiff;
    return parseTimeToMinutes(a.groupTime) - parseTimeToMinutes(b.groupTime);
  });

  // 3. If enough, return first N
  if (validPast.length >= payment.type) return validPast.slice(0, payment.type);

  // 4. If not enough, fill with generated future classes
  const afterDatesSet = new Set(validPast.map(cls => `${cls.groupId}_${cls.date}`));
  let nextDates = [];

  const futureGenerators = payment.groups.map(groupId => {
    const group = groups.find(g => g.id === groupId);
    if (!group) return null;

    return {
      groupId,
      groupName: group.name,
      gen: generateFutureDates(
        validPast.length === 0 ? paymentStart : new Date(),
        group.dayOfWeek,
        afterDatesSet,
        groupId,
        group.name,
        group.time || group.schedule || '',
        paymentStartTime,
        paymentStart
      ),
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
    let nextIdx = 0;

    for (let i = 1; i < nextDates.length; i++) {
      const current = nextDates[i].lastDate;
      const best = nextDates[nextIdx].lastDate;

      const currentDate = parseDate(current.date);
      const bestDate = parseDate(best.date);

      if (
        currentDate < bestDate ||
        (
          currentDate.getTime() === bestDate.getTime() &&
          parseTimeToMinutes(current.groupTime) < parseTimeToMinutes(best.groupTime)
        )
      ) {
        nextIdx = i;
      }
    }

    const chosen = nextDates[nextIdx].lastDate;
    validPast.push(chosen);
    afterDatesSet.add(`${chosen.groupId}_${chosen.date}`);

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
 * @param {Object} params.user            // {role: 'coach' | ...}
 * @param {Map}    params.pastClassesByGroup // optional groupId -> past class docs cache
 * @param {Function} params.loadPastClassDocs // shared, generation-aware loader
 * @returns {Promise<Array<{id: string, name: string, amount: string}>>}
 */
export async function getClassSignedStudentsByPayments({
  groupId,
  date,
  students,
  payments,
  groups,
  user,
  pastClassesByGroup,
  loadPastClassDocs,
}) {
  const result = [];
  const classCache = pastClassesByGroup || new Map();

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

    // Does this payment cover the class?
    const paymentClasses = await getPaymentClasses({
      payment,
      groups,
      pastClassesByGroup: classCache,
      loadPastClassDocs,
    });
    const coversClass = paymentClasses?.some(
      c => c.groupId === groupId && c.date === date
    );
    if (!coversClass) continue;

    const amount = user?.role === 'coach' ? 1 : (payment.amount / payment.type);

    result.push({
      id: student.id,
      name: student.name,
      amount: Number.isFinite(amount) ? amount.toFixed(2) : '0.00',
    });
  }

  return result;
}
