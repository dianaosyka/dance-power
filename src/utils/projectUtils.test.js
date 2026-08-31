import {
  formatLocalIsoDate,
  formatProjectDate,
  generateProjectSchedule,
  getProjectStatus,
  parseLocalIsoDate,
  validateProjectSchedule,
} from './projectUtils';

describe('project schedule helpers', () => {
  const twiceWeeklyProject = {
    startDate: '2026-09-01',
    endDate: '2026-09-30',
    totalClasses: 5,
    scheduleSlots: [
      { dayOfWeek: 4, time: '19:30' },
      { dayOfWeek: 2, time: '18:00' },
    ],
  };

  it('orders twice-weekly sessions and stops at the fixed class count', () => {
    expect(generateProjectSchedule(twiceWeeklyProject)).toEqual([
      { index: 1, isoDate: '2026-09-01', date: '01.09.2026', time: '18:00', dayOfWeek: 2 },
      { index: 2, isoDate: '2026-09-03', date: '03.09.2026', time: '19:30', dayOfWeek: 4 },
      { index: 3, isoDate: '2026-09-08', date: '08.09.2026', time: '18:00', dayOfWeek: 2 },
      { index: 4, isoDate: '2026-09-10', date: '10.09.2026', time: '19:30', dayOfWeek: 4 },
      { index: 5, isoDate: '2026-09-15', date: '15.09.2026', time: '18:00', dayOfWeek: 2 },
    ]);
    expect(validateProjectSchedule(twiceWeeklyProject)).toBe('');
  });

  it('includes both date boundaries and reports an insufficient range', () => {
    const inclusiveProject = {
      startDate: '2026-09-01',
      endDate: '2026-09-03',
      totalClasses: 2,
      scheduleSlots: [
        { dayOfWeek: 2, time: '18:00' },
        { dayOfWeek: 4, time: '19:30' },
      ],
    };

    expect(generateProjectSchedule(inclusiveProject).map(session => session.isoDate))
      .toEqual(['2026-09-01', '2026-09-03']);
    expect(validateProjectSchedule(inclusiveProject)).toBe('');

    expect(validateProjectSchedule({ ...inclusiveProject, totalClasses: 3 }))
      .toBe('The selected date range contains only 2 scheduled classes; 3 are required.');
  });

  it('rejects invalid ranges, counts, and schedule slots', () => {
    expect(validateProjectSchedule({ ...twiceWeeklyProject, startDate: '' }))
      .toBe('Please choose a valid project start date.');
    expect(validateProjectSchedule({
      ...twiceWeeklyProject,
      startDate: '2026-09-02',
      endDate: '2026-09-01',
    })).toBe('Project end date must be on or after the start date.');
    expect(validateProjectSchedule({ ...twiceWeeklyProject, totalClasses: 0 }))
      .toBe('Project must have a positive whole number of classes.');
    expect(validateProjectSchedule({ ...twiceWeeklyProject, scheduleSlots: [] }))
      .toBe('Add at least one weekly schedule.');
    expect(validateProjectSchedule({
      ...twiceWeeklyProject,
      scheduleSlots: [{ dayOfWeek: 7, time: '18:00' }],
    })).toBe('Every schedule needs a valid weekday and time.');
  });

  it('parses and formats ISO dates with local calendar components', () => {
    const parsed = parseLocalIsoDate('2026-03-29');

    expect(parsed).not.toBeNull();
    expect(parsed.getFullYear()).toBe(2026);
    expect(parsed.getMonth()).toBe(2);
    expect(parsed.getDate()).toBe(29);
    expect(formatLocalIsoDate(parsed)).toBe('2026-03-29');
    expect(formatProjectDate(parsed)).toBe('29.03.2026');

    // In positive UTC offsets this instant is still on the previous UTC date;
    // formatting must continue to use its local calendar day.
    const localEarlyMorning = new Date(2026, 0, 5, 0, 30);
    expect(formatProjectDate(localEarlyMorning)).toBe('05.01.2026');
    expect(parseLocalIsoDate('2026-02-31')).toBeNull();
  });
});

describe('getProjectStatus', () => {
  const project = {
    startDate: '2026-09-01',
    endDate: '2026-09-30',
  };

  it.each([
    [new Date(2026, 7, 31, 23, 59), 'upcoming'],
    [new Date(2026, 8, 1, 12, 0), 'active'],
    [new Date(2026, 8, 30, 23, 59), 'active'],
    [new Date(2026, 9, 1, 0, 0), 'completed'],
  ])('returns the local-date status for %s', (now, expectedStatus) => {
    expect(getProjectStatus(project, now)).toBe(expectedStatus);
  });
});
