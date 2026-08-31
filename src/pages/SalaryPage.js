import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  collection,
  doc,
  getDocFromServer,
  getDocsFromServer,
} from 'firebase/firestore';
import { useNavigate } from 'react-router-dom';
import { STAFF_DATA_CACHE_TTL_MS, useData } from '../context/firebase';
import { useUser } from '../context/UserContext';
import { getClassSignedStudentsByPayments } from '../utils/paymentsUtils';
import { getCoachPayForClass, getCoachRatePerPerson } from '../utils/coachSalaryUtils';
import {
  getEuropeanMonthFromMonthValue,
  getOtherPaymentReasonLabel,
  getOtherPaymentsFromMonthDocument,
  getOtherPaymentsForMonth,
  getOtherPaymentsTotal,
} from '../utils/otherPaymentsUtils';
import { getPaymentMethodLabel } from '../utils/paymentMethodUtils';
import {
  getProjectSalaryClasses,
  hasProjectSessionsForSalaryMonth,
} from '../utils/projectSalaryUtils';
import RefreshStatus from '../components/RefreshStatus';
import { getWorkshopSalary, getWorkshopMonth } from '../utils/workshopUtils';
import './SalaryPage.css';

function getCurrentMonthValue() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function getSavedMonthValue() {
  return localStorage.getItem('salarySelectedMonth') || getCurrentMonthValue();
}

function getSalarySummaryStorageKey(user, monthValue) {
  if (!user?.role || !monthValue) return null;

  const userKey = user.id || user.role;
  return `salarySummary:v11:${user.role}:${userKey}:${monthValue}`;
}

function getSavedSalarySummary(storageKey) {
  if (!storageKey) return { summary: null, isStale: false };

  try {
    const savedSummary = localStorage.getItem(storageKey);
    if (!savedSummary) return { summary: null, isStale: false };

    const summary = JSON.parse(savedSummary);
    const generatedAt = Number(summary?.generatedAt);
    return {
      summary,
      isStale:
        Number.isFinite(Number(summary?.invalidatedAt)) ||
        !Number.isFinite(generatedAt) ||
        Date.now() - generatedAt >= STAFF_DATA_CACHE_TTL_MS,
    };
  } catch (err) {
    console.error('Failed to load saved salary summary:', err);
    localStorage.removeItem(storageKey);
    return { summary: null, isStale: false };
  }
}

function isClassInMonth(dateStr, monthValue) {
  if (!dateStr || !monthValue) return false;

  const [dd, mm, yyyy] = dateStr.split('.');
  if (!dd || !mm || !yyyy) return false;

  return `${yyyy}-${mm.padStart(2, '0')}` === monthValue;
}

function getCoachIdsForClass(classData, group) {
  if (Array.isArray(classData?.coach) && classData.coach.length > 0) {
    return classData.coach;
  }

  return group?.coach ? [group.coach] : [];
}

function buildLessonsByCoach(classRows, workshopRows = []) {
  const lessonsByCoach = new Map();

  classRows.forEach(row => {
    if (!row.coachIds.length) {
      const existing = lessonsByCoach.get('no-coach') || {
        id: 'no-coach',
        name: 'No coach',
        lessons: [],
        workshops: [],
      };

      lessonsByCoach.set('no-coach', {
        ...existing,
        lessons: [...existing.lessons, row],
      });
      return;
    }

    row.coachIds.forEach(coachId => {
      const existing = lessonsByCoach.get(coachId) || {
        id: coachId,
        name: row.coachNamesById[coachId] || coachId,
        lessons: [],
        workshops: [],
      };

      lessonsByCoach.set(coachId, {
        ...existing,
        lessons: [...existing.lessons, row],
      });
    });
  });

  workshopRows.forEach(row => {
    if (!row.coachId) return;
    const existing = lessonsByCoach.get(row.coachId) || {
      id: row.coachId,
      name: row.coachName || row.coachId,
      lessons: [],
      workshops: [],
    };
    lessonsByCoach.set(row.coachId, {
      ...existing,
      workshops: [...(existing.workshops || []), row],
    });
  });

  return [...lessonsByCoach.values()]
    .map(coach => ({
      ...coach,
      lessons: coach.lessons.sort((a, b) => a.date.localeCompare(b.date)),
      workshops: (coach.workshops || []).sort((a, b) => String(a.date).localeCompare(String(b.date))),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function SalaryPage() {
  const navigate = useNavigate();
  const {
    groups,
    projects,
    workshops = [],
    payments,
    students,
    coaches,
    db,
    groupsLoaded,
    projectsLoaded,
    workshopsLoaded,
    coachesLoaded,
    groupsError,
    projectsError,
    workshopsError,
    coachesError,
    studentsLoaded,
    paymentsLoaded,
    studentsLoading,
    paymentsLoading,
    studentsError,
    paymentsError,
    studentsLastLoadedAt,
    paymentsLastLoadedAt,
    refreshStudents,
    refreshPayments,
    pastClassesByGroup,
    loadPastClassDocs,
    invalidatePastClasses,
  } = useData();
  const { user } = useUser();
  const isAdmin = user?.role === 'admin';
  const isCoach = user?.role === 'coach';
  const [selectedMonth, setSelectedMonth] = useState(getSavedMonthValue);
  const [isCalculating, setIsCalculating] = useState(false);
  const [isRefreshingData, setIsRefreshingData] = useState(false);
  const [summary, setSummary] = useState(null);
  const [summaryIsStale, setSummaryIsStale] = useState(false);
  const [error, setError] = useState('');
  const [showLessonMoney, setShowLessonMoney] = useState(false);
  const calculationInProgress = useRef(false);
  const calculationToken = useRef(0);

  const coachNames = useMemo(
    () => new Map((coaches || []).map(coach => [coach.id, coach.name || coach.id])),
    [coaches]
  );
  const salarySummaryStorageKey = useMemo(
    () => getSalarySummaryStorageKey(user, selectedMonth),
    [user, selectedMonth]
  );
  const activeSalaryKey = useRef(salarySummaryStorageKey);
  activeSalaryKey.current = salarySummaryStorageKey;

  useEffect(() => () => {
    calculationToken.current += 1;
    calculationInProgress.current = false;
  }, []);

  useEffect(() => {
    localStorage.setItem('salarySelectedMonth', selectedMonth);
  }, [selectedMonth]);

  useEffect(() => {
    const generatedAt = Number(summary?.generatedAt);
    if (
      !Number.isFinite(generatedAt) ||
      STAFF_DATA_CACHE_TTL_MS <= 0
    ) return undefined;

    const remaining = STAFF_DATA_CACHE_TTL_MS - (Date.now() - generatedAt);
    if (remaining <= 0) {
      setSummaryIsStale(true);
      return undefined;
    }

    const timer = setTimeout(
      () => setSummaryIsStale(true),
      Math.min(remaining, 2_147_483_647)
    );
    return () => clearTimeout(timer);
  }, [summary?.generatedAt]);

  useEffect(() => {
    // Invalidate any calculation still running for a previous month/account.
    calculationToken.current += 1;
    calculationInProgress.current = false;
    setIsCalculating(false);

    if (!salarySummaryStorageKey) {
      setSummary(null);
      setSummaryIsStale(false);
      return;
    }

    const saved = getSavedSalarySummary(salarySummaryStorageKey);
    setSummary(saved.summary);
    setSummaryIsStale(saved.isStale);
  }, [salarySummaryStorageKey]);

  const calculateSalary = useCallback(async ({
    refreshClasses = false,
    studentsOverride,
    paymentsOverride,
  } = {}) => {
    const hasStudents = studentsOverride !== undefined || studentsLoaded;
    const hasPayments = paymentsOverride !== undefined || paymentsLoaded;
    if (
      !selectedMonth ||
      !groupsLoaded ||
      !projectsLoaded ||
      !workshopsLoaded ||
      !coachesLoaded ||
      !hasStudents ||
      !hasPayments ||
      calculationInProgress.current
    ) return;

    if (refreshClasses) invalidatePastClasses();

    const runToken = ++calculationToken.current;
    const runSalaryKey = salarySummaryStorageKey;
    const runMonth = selectedMonth;
    calculationInProgress.current = true;
    setIsCalculating(true);
    setError('');

    try {
      const calculationStudents = studentsOverride ?? students;
      const calculationPayments = paymentsOverride ?? payments;
      const otherPaymentsSnapshot = await getDocFromServer(
        doc(db, 'otherpayments', getEuropeanMonthFromMonthValue(runMonth))
      );
      const calculationOtherPayments = getOtherPaymentsFromMonthDocument(
        otherPaymentsSnapshot
      );
      const otherPaymentsTotal = getOtherPaymentsTotal(
        calculationOtherPayments,
        runMonth
      );
      const studentNamesById = new Map(
        calculationStudents.map(student => [student.id, student.name || 'Unknown'])
      );
      const otherPaymentRows = getOtherPaymentsForMonth(
        calculationOtherPayments,
        runMonth
      )
        .map(payment => ({
          id: payment.id,
          studentId: payment.studentId,
          studentName: studentNamesById.get(payment.studentId) || 'Unknown',
          amount: Number(payment.amount),
          reason: getOtherPaymentReasonLabel(payment.reason),
          paymentMethod: getPaymentMethodLabel(payment.paymentMethod),
          dateFrom: payment.dateFrom,
          paymentDate: payment.createdAt,
        }))
        .sort((a, b) => a.dateFrom.localeCompare(b.dateFrom));
      const coachTotals = new Map(
        (coaches || []).map(coach => [
          coach.id,
          {
            id: coach.id,
            name: coach.name || coach.id,
            salary: 0,
            classes: 0,
            students: 0,
          },
        ])
      );

      const classRows = [];
      const workshopSalaryRows = [];
      let grossTotal = otherPaymentsTotal;
      let rentTotal = 580;
      let coachesTotal = 0;
      let classesEarnedTotal = 0;
      let workshopEarnedTotal = 0;

      for (const group of groups) {
        const pastClassDocs = await loadPastClassDocs(group.id);

        for (const classDoc of pastClassDocs) {
          const classData = classDoc.data();
          const date = classData?.date || classDoc.id;

          if (!isClassInMonth(date, runMonth) || classData?.canceled === true) {
            continue;
          }

          const rent = Number(classData?.rent || 0);
          const coachIds = getCoachIdsForClass(classData, group);

          if (isCoach && !coachIds.includes(user.id)) {
            continue;
          }

          const signedUp = await getClassSignedStudentsByPayments({
            groupId: group.id,
            date,
            students: calculationStudents,
            payments: calculationPayments,
            groups,
            user: { role: 'admin' },
            pastClassesByGroup,
            loadPastClassDocs,
          });

          const studentCount = signedUp.length;
          const coachRate = getCoachRatePerPerson(group, date, studentCount);
          const coachPay = getCoachPayForClass(group, date, studentCount);
          const classGross = signedUp.reduce(
            (sum, student) => sum + Number.parseFloat(student?.amount || 0),
            0
          );
          const classCoachesTotal = coachIds.length * coachPay;
          const classEarned = classGross - rent - classCoachesTotal;

          grossTotal += classGross;
          rentTotal += rent;
          coachesTotal += classCoachesTotal;
          classesEarnedTotal += classEarned;

          coachIds.forEach(coachId => {
            const existing = coachTotals.get(coachId) || {
              id: coachId,
              name: coachNames.get(coachId) || coachId,
              salary: 0,
              classes: 0,
              students: 0,
            };

            coachTotals.set(coachId, {
              ...existing,
              salary: existing.salary + coachPay,
              classes: existing.classes + 1,
              students: existing.students + studentCount,
            });
          });

          classRows.push({
            id: `${group.id}-${date}`,
            groupId: group.id,
            groupName: group.name,
            date,
            comment: typeof classData?.comment === 'string' ? classData.comment.trim() : '',
            gross: classGross,
            rent,
            coaches: classCoachesTotal,
            earned: classEarned,
            studentCount,
            coachRate,
            coachPay,
            coachIds,
            coachNames: coachIds.map(coachId => coachNames.get(coachId) || coachId),
            coachNamesById: Object.fromEntries(
              coachIds.map(coachId => [coachId, coachNames.get(coachId) || coachId])
            ),
          });
        }
      }


      // Project revenue and coach pay stay fully scoped to each project. A
      // deterministic payment document per student means one paid person can
      // only be counted once, matching permanent-group salary semantics while
      // keeping project payments out of the root payments collection.
      for (const project of projects) {
        const coachIds = project?.coach ? [project.coach] : [];
        if (isCoach && !coachIds.includes(user.id)) continue;
        if (!hasProjectSessionsForSalaryMonth(project, runMonth)) continue;

        const projectPaymentSnapshot = await getDocsFromServer(
          collection(db, `projects/${project.id}/payments`)
        );
        const projectPayments = projectPaymentSnapshot.docs
          .map(paymentDoc => ({ id: paymentDoc.id, ...paymentDoc.data() }));
        const projectSalaryClasses = getProjectSalaryClasses({
          project,
          payments: projectPayments,
          monthValue: runMonth,
        });

        for (const session of projectSalaryClasses) {
          const studentCount = session.studentCount;
          const grossPerClass = session.gross;
          const coachRate = session.coachRate;
          const coachPay = session.coachPay;
          const classCoachesTotal = coachIds.length * coachPay;
          const classEarned = grossPerClass - classCoachesTotal;

          grossTotal += grossPerClass;
          coachesTotal += classCoachesTotal;
          classesEarnedTotal += classEarned;

          coachIds.forEach(coachId => {
            const existing = coachTotals.get(coachId) || {
              id: coachId,
              name: coachNames.get(coachId) || coachId,
              salary: 0,
              classes: 0,
              students: 0,
            };
            coachTotals.set(coachId, {
              ...existing,
              salary: existing.salary + coachPay,
              classes: existing.classes + 1,
              students: existing.students + studentCount,
            });
          });

          classRows.push({
            id: `project-${project.id}-${session.date}-${session.time}`,
            projectId: project.id,
            groupName: project.name,
            date: session.date,
            comment: '',
            gross: grossPerClass,
            rent: 0,
            coaches: classCoachesTotal,
            earned: classEarned,
            studentCount,
            coachRate,
            coachPay,
            coachIds,
            coachNames: coachIds.map(coachId => coachNames.get(coachId) || coachId),
            coachNamesById: Object.fromEntries(
              coachIds.map(coachId => [coachId, coachNames.get(coachId) || coachId])
            ),
          });
        }
      }

      // Workshop revenue belongs to the month in which the workshop takes
      // place, regardless of when participants paid.
      for (const workshop of workshops) {
        if (getWorkshopMonth(workshop.date) !== runMonth) continue;
        const coachIds = [...new Set((workshop.coaches || []).filter(Boolean))];
        if (isCoach && !coachIds.includes(user.id)) continue;
        const snapshot = await getDocsFromServer(collection(db, `workshops/${workshop.id}/payments`));
        const workshopPayments = snapshot.docs.map(item => ({ id: item.id, ...item.data() }));
        const workshopSalary = getWorkshopSalary({ workshop, payments: workshopPayments, monthValue: runMonth });
        if (!workshopSalary) continue;

        grossTotal += workshopSalary.gross;
        coachesTotal += workshopSalary.coachesTotal;
        workshopEarnedTotal += workshopSalary.ownerEarned;
        coachIds.forEach(coachId => {
          const existing = coachTotals.get(coachId) || { id: coachId, name: coachNames.get(coachId) || coachId, salary: 0, classes: 0, students: 0 };
          coachTotals.set(coachId, {
            ...existing,
            salary: existing.salary + workshopSalary.coachPayEach,
            students: existing.students + workshopSalary.studentCount,
          });
        });
        const rowCoachIds = isCoach ? coachIds.filter(id => id === user.id) : coachIds;
        rowCoachIds.forEach(coachId => {
          workshopSalaryRows.push({
            id: `${workshop.id}-${coachId}`,
            workshopId: workshop.id,
            name: workshop.name || workshop.id,
            date: workshop.date,
            gross: workshopSalary.gross,
            coachId,
            coachName: coachNames.get(coachId) || coachId,
            coachPay: workshopSalary.coachPayEach,
            studentCount: workshopSalary.studentCount,
          });
        });
      }

      const sortedClassRows = classRows.sort((a, b) => a.date.localeCompare(b.date));
      const sortedCoachTotals = [...coachTotals.values()]
        .filter(coach => coach.salary > 0 || coach.classes > 0)
        .sort((a, b) => b.salary - a.salary);
      const visibleCoachTotals = isCoach
        ? sortedCoachTotals.filter(coach => coach.id === user.id)
        : sortedCoachTotals;
      const visibleLessonsByCoach = isCoach
        ? buildLessonsByCoach(sortedClassRows, workshopSalaryRows).filter(coach => coach.id === user.id)
        : buildLessonsByCoach(sortedClassRows, workshopSalaryRows);
      const myCoachTotal = visibleCoachTotals[0] || {
        id: user?.id,
        name: coachNames.get(user?.id) || 'My salary',
        salary: 0,
        classes: 0,
        students: 0,
      };

      const nextSummary = {
        generatedAt: Date.now(),
        grossTotal,
        classesEarnedTotal,
        workshopEarnedTotal,
        workshopSalaryRows,
        otherEarnedTotal: otherPaymentsTotal,
        otherPaymentsTotal,
        otherPaymentRows,
        rentTotal,
        coachesTotal,
        earnedTotal: grossTotal - rentTotal - coachesTotal,
        coachTotals: visibleCoachTotals,
        myCoachTotal,
        classRows: sortedClassRows,
        lessonsByCoach: visibleLessonsByCoach,
      };

      if (
        calculationToken.current !== runToken ||
        activeSalaryKey.current !== runSalaryKey
      ) {
        return;
      }

      setSummary(nextSummary);
      setSummaryIsStale(false);

      if (runSalaryKey) {
        localStorage.setItem(runSalaryKey, JSON.stringify(nextSummary));
      }
    } catch (err) {
      console.error('Failed to calculate salary:', err);
      if (
        calculationToken.current === runToken &&
        activeSalaryKey.current === runSalaryKey
      ) {
        setError('Failed to calculate salary. Check console for details.');
      }
    } finally {
      if (calculationToken.current === runToken) {
        calculationInProgress.current = false;
        setIsCalculating(false);
      }
    }
  }, [
    coachNames,
    coaches,
    groups,
    groupsLoaded,
    projects,
    projectsLoaded,
    workshops,
    workshopsLoaded,
    coachesLoaded,
    db,
    invalidatePastClasses,
    isCoach,
    loadPastClassDocs,
    payments,
    pastClassesByGroup,
    salarySummaryStorageKey,
    selectedMonth,
    students,
    studentsLoaded,
    paymentsLoaded,
    user,
  ]);

  const handleSalaryAction = async () => {
    if (isRefreshingData || calculationInProgress.current) return;
    if (!groupsLoaded || !projectsLoaded || !workshopsLoaded || !coachesLoaded) {
      setError('Groups, projects, workshops, and coaches must finish loading before salary can be calculated.');
      return;
    }

    const now = Date.now();
    const needsStudentRefresh =
      !studentsLoaded
      || Boolean(studentsError)
      || !Number.isFinite(Number(studentsLastLoadedAt))
      || now - Number(studentsLastLoadedAt) >= STAFF_DATA_CACHE_TTL_MS;
    const needsPaymentRefresh =
      !paymentsLoaded
      || Boolean(paymentsError)
      || !Number.isFinite(Number(paymentsLastLoadedAt))
      || now - Number(paymentsLastLoadedAt) >= STAFF_DATA_CACHE_TTL_MS;
    const needsDataRecovery = needsStudentRefresh || needsPaymentRefresh;

    // A first calculation may reuse source collections already loaded elsewhere
    // in this session, but only while they remain inside the freshness window.
    // Refreshing an existing summary always verifies both collections again.
    if (!summary && !needsDataRecovery) {
      await calculateSalary();
      return;
    }

    setIsRefreshingData(true);
    setError('');
    try {
      const [freshStudents, freshPayments] = await Promise.all([
        summary || needsStudentRefresh ? refreshStudents() : Promise.resolve(students),
        summary || needsPaymentRefresh ? refreshPayments() : Promise.resolve(payments),
      ]);
      await calculateSalary({
        refreshClasses: Boolean(summary),
        studentsOverride: freshStudents,
        paymentsOverride: freshPayments,
      });
    } catch (err) {
      console.error('Failed to refresh salary data:', err);
      setError('Failed to refresh salary data. The previous summary is unchanged.');
    } finally {
      setIsRefreshingData(false);
    }
  };

  const salaryActionLoading =
    isRefreshingData || isCalculating || studentsLoading || paymentsLoading;
  const salaryActionLabel = studentsError || paymentsError
    ? 'Retry data'
    : !studentsLoaded || !paymentsLoaded
      || !Number.isFinite(Number(studentsLastLoadedAt))
      || !Number.isFinite(Number(paymentsLastLoadedAt))
      || Date.now() - Number(studentsLastLoadedAt) >= STAFF_DATA_CACHE_TTL_MS
      || Date.now() - Number(paymentsLastLoadedAt) >= STAFF_DATA_CACHE_TTL_MS
      ? 'Load data'
      : summary
        ? 'Refresh salary'
        : 'Calculate salary';
  const salarySourceError = [
    groupsError ? `Groups: ${groupsError}` : '',
    projectsError ? `Projects: ${projectsError}` : '',
    workshopsError ? `Workshops: ${workshopsError}` : '',
    coachesError ? `Coaches: ${coachesError}` : '',
    studentsError ? `Students: ${studentsError}` : '',
    paymentsError ? `Payments: ${paymentsError}` : '',
  ].filter(Boolean).join(' · ');
  const salaryStatusError = salarySourceError
    || error
    || (summaryIsStale && summary && !isCalculating
      ? 'Saved salary may be outdated. It remains visible until you choose Refresh salary.'
      : '');

  if (!isAdmin && !isCoach) {
    return (
      <div className="salary-page">
        <button className="salary-back-button" onClick={() => navigate('/groups')}>
          Back
        </button>
        <h2>Salary</h2>
        <p>Only admins and coaches can see this page.</p>
      </div>
    );
  }

  return (
    <div className="salary-page">
      <button className="salary-back-button" onClick={() => navigate('/groups')}>
        Back
      </button>
      <h2 className="salary-title">SALARY</h2>

      <div className="salary-controls">
        <label className="salary-label" htmlFor="salary-month">
          Month
        </label>
        <input
          id="salary-month"
          className="salary-month-input"
          type="month"
          value={selectedMonth}
          onChange={(event) => setSelectedMonth(event.target.value)}
          disabled={isRefreshingData || isCalculating}
        />
        <RefreshStatus
          message={summary?.generatedAt
            ? `Last updated: ${new Date(summary.generatedAt).toLocaleString()}`
            : 'Not updated yet'}
          error={salaryStatusError}
          loading={salaryActionLoading || !groupsLoaded || !projectsLoaded || !workshopsLoaded || !coachesLoaded}
          onRefresh={handleSalaryAction}
          disabled={!groupsLoaded || !projectsLoaded || !workshopsLoaded || !coachesLoaded}
          refreshLabel={salaryActionLabel}
          loadingLabel={!groupsLoaded || !projectsLoaded || !workshopsLoaded || !coachesLoaded ? 'Loading data…' : 'Refreshing…'}
          className="salary-refresh-status"
        />
      </div>

      {summary && (
        <>
          {isAdmin ? (
            <div className="salary-summary">
              <div>
                <span>All earned</span>
                <strong>{summary.earnedTotal.toFixed(2)}€</strong>
              </div>
              <div>
                <span>Earned from classes</span>
                <strong>{Number(summary.classesEarnedTotal || 0).toFixed(2)}€</strong>
              </div>
              <div>
                <span>Earned from workshops</span>
                <strong>{Number(summary.workshopEarnedTotal || 0).toFixed(2)}€</strong>
              </div>
              <div>
                <span>Earned from other</span>
                <strong>{Number(summary.otherEarnedTotal || 0).toFixed(2)}€</strong>
              </div>
              <div>
                <span>Gross</span>
                <strong>{summary.grossTotal.toFixed(2)}€</strong>
              </div>
              <div>
                <span>For coaches</span>
                <strong>{summary.coachesTotal.toFixed(2)}€</strong>
              </div>
              <div>
                <span>Rent</span>
                <strong>{summary.rentTotal.toFixed(2)}€</strong>
              </div>
            </div>
          ) : (
            <div className="salary-summary">
              <div>
                <span>My salary</span>
                <strong>{summary.myCoachTotal.salary.toFixed(2)}€</strong>
              </div>
              <div>
                <span>My classes</span>
                <strong>{summary.myCoachTotal.classes}</strong>
              </div>
              <div>
                <span>Students taught</span>
                <strong>{summary.myCoachTotal.students}</strong>
              </div>
            </div>
          )}

          <h3 className="salary-heading">{isAdmin ? 'COACHES' : 'MY SALARY'}</h3>
          <ul className="salary-list">
            {summary.coachTotals.length === 0 ? (
              <li className="salary-row">
                {isAdmin ? 'No coach salary in this month.' : 'No salary in this month.'}
              </li>
            ) : (
              summary.coachTotals.map(coach => (
                <li key={coach.id} className="salary-row">
                  <span>{coach.name}</span>
                  <span>{coach.classes} classes</span>
                  <strong>{coach.salary.toFixed(2)}€</strong>
                </li>
              ))
            )}
          </ul>

          <div className="salary-lessons-header">
            <h3 className="salary-heading">{isAdmin ? 'COACH BREAKDOWN' : 'MY BREAKDOWN'}</h3>
            <button
              className="salary-small-button"
              onClick={() => setShowLessonMoney(current => !current)}
            >
              {showLessonMoney ? 'Hide money' : 'Show money'}
            </button>
          </div>
          <ul className="salary-list">
            {summary.lessonsByCoach.length === 0 ? (
              <li className="salary-row">No lessons or workshop earnings in this month.</li>
            ) : (
              summary.lessonsByCoach.map(coach => (
                <li key={coach.id} className="salary-coach-lessons">
                  <div className="salary-coach-name">{coach.name}</div>
                  <ul className="salary-list">
                    {coach.lessons.map(row => (
                      <li
                        key={`${coach.id}-${row.id}`}
                        className={`salary-lesson-row${row.comment ? ' has-urgent-comment' : ''}`}
                        role="button"
                        tabIndex={0}
                        onClick={() => navigate(row.projectId
                          ? `/project/${row.projectId}`
                          : `/group/${row.groupId}/class/${row.date}`)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            navigate(row.projectId
                              ? `/project/${row.projectId}`
                              : `/group/${row.groupId}/class/${row.date}`);
                          }
                        }}
                      >
                        <div className="salary-lesson-main">
                          <div>
                            <strong>{row.date}</strong>
                            <span>{row.groupName}</span>
                          </div>
                          <div>
                            <span>{row.studentCount} people</span>
                            {showLessonMoney && (
                              <strong>
                                {Number(isCoach ? (row.coachPay ?? row.studentCount) : row.earned).toFixed(2)}€
                              </strong>
                            )}
                          </div>
                        </div>
                        {row.comment && (
                          <div className="salary-lesson-comment">
                            <span className="salary-lesson-comment-label">Incomplete payment</span>
                            <strong>{row.comment}</strong>
                          </div>
                        )}
                      </li>
                    ))}
                    {(coach.workshops || []).map(workshop => (
                      <li
                        key={workshop.id}
                        className="salary-workshop-row"
                        role="button"
                        tabIndex={0}
                        onClick={() => navigate(`/workshop/${workshop.workshopId}`)}
                        onKeyDown={event => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            navigate(`/workshop/${workshop.workshopId}`);
                          }
                        }}
                      >
                        <div className="salary-workshop-main">
                          <div>
                            <span className="salary-workshop-badge">Workshop</span>
                            <strong>{workshop.name}</strong>
                          </div>
                          <strong>{Number(workshop.coachPay || 0).toFixed(2)}€</strong>
                        </div>
                        <div className="salary-workshop-meta">
                          <span>{workshop.date}</span>
                          <span>{workshop.studentCount} paid</span>
                        </div>
                      </li>
                    ))}
                  </ul>
                </li>
              ))
            )}
          </ul>

          {isAdmin && (
            <>
              <div className="salary-lessons-header">
                <h3 className="salary-heading">OTHER PAYMENTS</h3>
                <strong className="salary-other-payments-total">
                  {Number(summary.otherPaymentsTotal || 0).toFixed(2)}€
                </strong>
              </div>
              <ul className="salary-list">
                {(summary.otherPaymentRows || []).length === 0 ? (
                  <li className="salary-row">No other payments in this month.</li>
                ) : (
                  summary.otherPaymentRows.map(payment => (
                    <li key={payment.id} className="salary-other-payment-row">
                      <div className="salary-other-payment-main">
                        <div>
                          <strong>{payment.studentName}</strong>
                          <span>{payment.reason} · {payment.paymentMethod || 'Card'}</span>
                        </div>
                        <strong>{Number(payment.amount).toFixed(2)}€</strong>
                      </div>
                      <div className="salary-other-payment-dates">
                        <span>Date from: {payment.dateFrom}</span>
                        <span>Paid: {payment.paymentDate}</span>
                      </div>
                    </li>
                  ))
                )}
              </ul>
            </>
          )}
        </>
      )}
    </div>
  );
}

export default SalaryPage;
