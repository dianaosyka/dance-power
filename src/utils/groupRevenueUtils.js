export function getMonthlyGroupRevenue(classRows = [], ownerCoachIds = new Set()) {
  const groups = new Map();

  classRows.forEach(row => {
    const entityId = row?.projectId
      ? `project:${row.projectId}`
      : row?.groupId
        ? `group:${row.groupId}`
        : null;
    if (!entityId) return;

    const current = groups.get(entityId) || {
      id: entityId,
      name: row.groupName || row.projectId || row.groupId,
      gross: 0,
      rent: 0,
      coaches: 0,
      ownerCoaches: 0,
      earned: 0,
      classes: 0,
      students: 0,
    };

    const savedOwnerCoachPay = Number(row.ownerCoaches);
    const ownerCoachPay = Number.isFinite(savedOwnerCoachPay)
      ? savedOwnerCoachPay
      : (row.coachIds || []).filter(coachId => ownerCoachIds.has(coachId)).length
        * Number(row.coachPay || 0);

    groups.set(entityId, {
      ...current,
      gross: current.gross + Number(row.gross || 0),
      rent: current.rent + Number(row.rent || 0),
      coaches: current.coaches + Number(row.coaches || 0),
      ownerCoaches: current.ownerCoaches + ownerCoachPay,
      earned: current.earned + Number(row.earned || 0),
      classes: current.classes + 1,
      students: current.students + Number(row.studentCount || 0),
    });
  });

  return [...groups.values()].sort((a, b) =>
    b.earned - a.earned || a.name.localeCompare(b.name)
  );
}
