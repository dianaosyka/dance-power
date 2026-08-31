import { getWorkshopSalary } from './workshopUtils';

const payments = [
  { studentId: 'a', amount: 100, status: 'active' },
  { studentId: 'b', amount: 100, status: 'active' },
];

test('one workshop coach receives 30 percent in the workshop month', () => {
  expect(getWorkshopSalary({
    workshop: { date: '2026-09-15', coaches: ['c1'] }, payments, monthValue: '2026-09',
  })).toMatchObject({ gross: 200, coachPayEach: 60, coachesTotal: 60, ownerEarned: 140 });
});

test('two workshop coaches receive 20 percent each', () => {
  expect(getWorkshopSalary({
    workshop: { date: '2026-09-15', coaches: ['c1', 'c2'] }, payments, monthValue: '2026-09',
  })).toMatchObject({ gross: 200, coachPayEach: 40, coachesTotal: 80, ownerEarned: 120 });
});

test('payment date does not move workshop revenue to another month', () => {
  expect(getWorkshopSalary({
    workshop: { date: '2026-09-15', coaches: ['c1'] },
    payments: [{ ...payments[0], createdAt: '01.08.2026' }],
    monthValue: '2026-08',
  })).toBeNull();
});
