import { getMonthlyGroupRevenue } from './groupRevenueUtils';

describe('getMonthlyGroupRevenue', () => {
  it('aggregates monthly revenue and costs for each permanent group', () => {
    const result = getMonthlyGroupRevenue([
      {
        groupId: 'heels', groupName: 'Heels', gross: 80, rent: 20,
        coaches: 16, earned: 44, studentCount: 8,
      },
      {
        groupId: 'heels', groupName: 'Heels', gross: 100, rent: 20,
        coaches: 20, earned: 60, studentCount: 10,
      },
      {
        groupId: 'jazz', groupName: 'Jazz', gross: 60, rent: 15,
        coaches: 12, earned: 33, studentCount: 6,
      },
    ]);

    expect(result).toEqual([
      {
        id: 'group:heels', name: 'Heels', gross: 180, rent: 40,
        coaches: 36, ownerCoaches: 0, earned: 104, classes: 2, students: 18,
      },
      {
        id: 'group:jazz', name: 'Jazz', gross: 60, rent: 15,
        coaches: 12, ownerCoaches: 0, earned: 33, classes: 1, students: 6,
      },
    ]);
  });

  it('includes project groups and keeps them separate from permanent groups', () => {
    expect(getMonthlyGroupRevenue([
      {
        projectId: 'project-1', groupName: 'Show project', gross: 100,
        coaches: 20, earned: 80, studentCount: 10,
      },
      {
        groupId: 'project-1', groupName: 'Regular group', gross: 50,
        rent: 10, coaches: 10, earned: 30, studentCount: 5,
      },
    ])).toEqual([
      {
        id: 'project:project-1', name: 'Show project', gross: 100, rent: 0,
        coaches: 20, ownerCoaches: 0, earned: 80, classes: 1, students: 10,
      },
      {
        id: 'group:project-1', name: 'Regular group', gross: 50, rent: 10,
        coaches: 10, ownerCoaches: 0, earned: 30, classes: 1, students: 5,
      },
    ]);
  });

  it('recovers owner coach pay from cached class rows', () => {
    expect(getMonthlyGroupRevenue([
      {
        groupId: 'heels', groupName: 'Heels', gross: 80, rent: 20,
        coaches: 0, earned: 60, studentCount: 8,
        coachIds: ['owner-1'], coachPay: 16,
      },
    ], new Set(['owner-1']))).toEqual([
      {
        id: 'group:heels', name: 'Heels', gross: 80, rent: 20,
        coaches: 0, ownerCoaches: 16, earned: 60, classes: 1, students: 8,
      },
    ]);
  });

  it('includes each workshop once and subtracts only non-owner coach pay', () => {
    const workshopRows = [
      {
        workshopId: 'ws-1', name: 'Heels intensive', gross: 200,
        coachId: 'owner-1', coachPay: 40, studentCount: 10,
      },
      {
        workshopId: 'ws-1', name: 'Heels intensive', gross: 200,
        coachId: 'coach-2', coachPay: 40, studentCount: 10,
      },
    ];

    expect(getMonthlyGroupRevenue([], new Set(['owner-1']), workshopRows)).toEqual([
      {
        id: 'workshop:ws-1', name: 'Heels intensive', gross: 200, rent: 0,
        coaches: 40, ownerCoaches: 40, earned: 160, classes: 1, students: 10,
      },
    ]);
  });
});
