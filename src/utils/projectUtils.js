const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

/**
 * Parse YYYY-MM-DD as a local calendar date.
 *
 * `new Date('YYYY-MM-DD')` is parsed as UTC by JavaScript, which can move the
 * displayed day in some time zones. Building the date from its components
 * keeps project schedules tied to the local calendar instead.
 */
export function parseLocalIsoDate(value) {
  const match = String(value || '').trim().match(ISO_DATE_PATTERN);
  if (!match) return null;

  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  const day = Number(match[3]);
  const date = new Date(year, monthIndex, day);
  date.setHours(0, 0, 0, 0);

  // The Date constructor rolls invalid values (for example 31 February) into
  // the next month, so compare the resulting components with the input.
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== monthIndex ||
    date.getDate() !== day
  ) {
    return null;
  }

  return date;
}

function asLocalCalendarDate(value) {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return new Date(value.getFullYear(), value.getMonth(), value.getDate());
  }

  return parseLocalIsoDate(value);
}

export function formatLocalIsoDate(value) {
  const date = asLocalCalendarDate(value);
  if (!date) return '';

  return [
    String(date.getFullYear()).padStart(4, '0'),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
}

export function formatProjectDate(value) {
  const date = asLocalCalendarDate(value);
  if (!date) return '';

  return [
    String(date.getDate()).padStart(2, '0'),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getFullYear()).padStart(4, '0'),
  ].join('.');
}

function normalizeClassCount(value) {
  if (typeof value === 'string' && value.trim() === '') return null;
  const count = Number(value);
  return Number.isInteger(count) && count > 0 ? count : null;
}

function normalizeDayOfWeek(value) {
  if (typeof value === 'number') {
    return Number.isInteger(value) && value >= 0 && value <= 6 ? value : null;
  }

  if (typeof value === 'string' && /^[0-6]$/.test(value.trim())) {
    return Number(value.trim());
  }

  return null;
}

function normalizeScheduleSlot(slot) {
  const dayOfWeek = normalizeDayOfWeek(slot?.dayOfWeek);
  const time = typeof slot?.time === 'string' ? slot.time.trim() : '';

  if (dayOfWeek === null || !TIME_PATTERN.test(time)) return null;
  return { dayOfWeek, time };
}

function getNormalizedScheduleSlots(scheduleSlots) {
  if (!Array.isArray(scheduleSlots)) return [];

  const uniqueSlots = new Map();
  scheduleSlots.forEach(slot => {
    const normalized = normalizeScheduleSlot(slot);
    if (!normalized) return;
    uniqueSlots.set(`${normalized.dayOfWeek}:${normalized.time}`, normalized);
  });

  return [...uniqueSlots.values()].sort((first, second) => (
    first.dayOfWeek - second.dayOfWeek || first.time.localeCompare(second.time)
  ));
}

export function generateProjectSchedule(project) {
  const startDate = parseLocalIsoDate(project?.startDate);
  const endDate = parseLocalIsoDate(project?.endDate);
  const totalClasses = normalizeClassCount(project?.totalClasses);
  const scheduleSlots = getNormalizedScheduleSlots(project?.scheduleSlots);

  if (
    !startDate ||
    !endDate ||
    endDate < startDate ||
    totalClasses === null ||
    scheduleSlots.length === 0
  ) {
    return [];
  }

  const slotsByDay = new Map();
  scheduleSlots.forEach(slot => {
    const slots = slotsByDay.get(slot.dayOfWeek) || [];
    slots.push(slot);
    slotsByDay.set(slot.dayOfWeek, slots);
  });

  const sessions = [];
  const seenSessions = new Set();
  const cursor = new Date(startDate);

  while (cursor <= endDate && sessions.length < totalClasses) {
    const slots = slotsByDay.get(cursor.getDay()) || [];
    const isoDate = formatLocalIsoDate(cursor);

    for (const slot of slots) {
      if (sessions.length >= totalClasses) break;

      const sessionKey = `${isoDate}:${slot.time}`;
      if (seenSessions.has(sessionKey)) continue;
      seenSessions.add(sessionKey);
      sessions.push({
        index: sessions.length + 1,
        isoDate,
        date: formatProjectDate(cursor),
        time: slot.time,
        dayOfWeek: slot.dayOfWeek,
      });
    }

    cursor.setDate(cursor.getDate() + 1);
  }

  return sessions;
}

export function validateProjectSchedule(project) {
  const startDate = parseLocalIsoDate(project?.startDate);
  if (!startDate) return 'Please choose a valid project start date.';

  const endDate = parseLocalIsoDate(project?.endDate);
  if (!endDate) return 'Please choose a valid project end date.';
  if (endDate < startDate) {
    return 'Project end date must be on or after the start date.';
  }

  const totalClasses = normalizeClassCount(project?.totalClasses);
  if (totalClasses === null) {
    return 'Project must have a positive whole number of classes.';
  }

  if (!Array.isArray(project?.scheduleSlots) || project.scheduleSlots.length === 0) {
    return 'Add at least one weekly schedule.';
  }

  const normalizedSlots = project.scheduleSlots.map(normalizeScheduleSlot);
  if (normalizedSlots.some(slot => slot === null)) {
    return 'Every schedule needs a valid weekday and time.';
  }

  const uniqueSlotKeys = new Set(
    normalizedSlots.map(slot => `${slot.dayOfWeek}:${slot.time}`)
  );
  if (uniqueSlotKeys.size !== normalizedSlots.length) {
    return 'Weekly schedules must be unique.';
  }

  const generatedClasses = generateProjectSchedule(project);
  if (generatedClasses.length < totalClasses) {
    const occurrenceLabel = generatedClasses.length === 1 ? 'class' : 'classes';
    return (
      `The selected date range contains only ${generatedClasses.length} scheduled ` +
      `${occurrenceLabel}; ${totalClasses} are required.`
    );
  }

  return '';
}

export function getProjectStatus(project, now = new Date()) {
  const startDate = parseLocalIsoDate(project?.startDate);
  const endDate = parseLocalIsoDate(project?.endDate);
  const today = asLocalCalendarDate(now);

  // Invalid projects should be caught by validateProjectSchedule. Returning an
  // upcoming state keeps this display helper predictable while a form is being
  // filled in.
  if (!startDate || !endDate || !today) return 'upcoming';
  if (today < startDate) return 'upcoming';
  if (today > endDate) return 'completed';
  return 'active';
}
