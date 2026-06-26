import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { collection, getDocs } from 'firebase/firestore';
import { useData } from '../context/firebase';
import { useUser } from '../context/UserContext';
import { getClassSignedStudentsByPayments } from '../utils/paymentsUtils';
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

  const userKey = user.role === 'coach' ? user.id : user.role;
  return `salarySummary:${user.role}:${userKey}:${monthValue}`;
}

function getSavedSalarySummary(storageKey) {
  if (!storageKey) return null;

  try {
    const savedSummary = localStorage.getItem(storageKey);
    return savedSummary ? JSON.parse(savedSummary) : null;
  } catch (err) {
    console.error('Failed to load saved salary summary:', err);
    localStorage.removeItem(storageKey);
    return null;
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

function buildLessonsByCoach(classRows) {
  const lessonsByCoach = new Map();

  classRows.forEach(row => {
    if (!row.coachIds.length) {
      const existing = lessonsByCoach.get('no-coach') || {
        id: 'no-coach',
        name: 'No coach',
        lessons: [],
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
      };

      lessonsByCoach.set(coachId, {
        ...existing,
        lessons: [...existing.lessons, row],
      });
    });
  });

  return [...lessonsByCoach.values()]
    .map(coach => ({
      ...coach,
      lessons: coach.lessons.sort((a, b) => a.date.localeCompare(b.date)),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function SalaryPage() {
  const navigate = useNavigate();
  const { db, groups, payments, students, coaches } = useData();
  const { user } = useUser();
  const isAdmin = user?.role === 'admin';
  const isCoach = user?.role === 'coach';
  const [selectedMonth, setSelectedMonth] = useState(getSavedMonthValue);
  const [isCalculating, setIsCalculating] = useState(false);
  const [summary, setSummary] = useState(null);
  const [error, setError] = useState('');
  const [showLessonMoney, setShowLessonMoney] = useState(false);
  const calculationInProgress = useRef(false);

  const coachNames = useMemo(
    () => new Map((coaches || []).map(coach => [coach.id, coach.name || coach.id])),
    [coaches]
  );
  const salarySummaryStorageKey = useMemo(
    () => getSalarySummaryStorageKey(user, selectedMonth),
    [user, selectedMonth]
  );

  useEffect(() => {
    localStorage.setItem('salarySelectedMonth', selectedMonth);
  }, [selectedMonth]);

  useEffect(() => {
    if (!salarySummaryStorageKey) {
      setSummary(null);
      return;
    }

    setSummary(getSavedSalarySummary(salarySummaryStorageKey));
  }, [salarySummaryStorageKey]);

  const calculateSalary = useCallback(async () => {
    if (!selectedMonth || calculationInProgress.current) return;

    calculationInProgress.current = true;
    setIsCalculating(true);
    setError('');

    try {
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
      let grossTotal = 0;
      let rentTotal = 580;
      let coachesTotal = 0;
      const pastClassesByGroup = new Map();

      for (const group of groups) {
        const snap = await getDocs(collection(db, `groups/${group.id}/pastClasses`));
        pastClassesByGroup.set(
          group.id,
          snap.docs.map(doc => ({
            id: doc.id,
            data: () => doc.data(),
          }))
        );

        for (const classDoc of snap.docs) {
          const classData = classDoc.data();
          const date = classData?.date || classDoc.id;

          if (!isClassInMonth(date, selectedMonth) || classData?.canceled === true) {
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
            students,
            payments,
            groups,
            db,
            user: { role: 'admin' },
            pastClassesByGroup,
          });

          const studentCount = signedUp.length;
          const classGross = signedUp.reduce(
            (sum, student) => sum + Number.parseFloat(student?.amount || 0),
            0
          );
          const classCoachesTotal = coachIds.length * studentCount;
          const classEarned = classGross - rent - classCoachesTotal;

          grossTotal += classGross;
          rentTotal += rent;
          coachesTotal += classCoachesTotal;

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
              salary: existing.salary + studentCount,
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
            coachIds,
            coachNames: coachIds.map(coachId => coachNames.get(coachId) || coachId),
            coachNamesById: Object.fromEntries(
              coachIds.map(coachId => [coachId, coachNames.get(coachId) || coachId])
            ),
          });
        }
      }

      const sortedClassRows = classRows.sort((a, b) => a.date.localeCompare(b.date));
      const sortedCoachTotals = [...coachTotals.values()]
        .filter(coach => coach.salary > 0 || coach.classes > 0)
        .sort((a, b) => b.salary - a.salary);
      const visibleCoachTotals = isCoach
        ? sortedCoachTotals.filter(coach => coach.id === user.id)
        : sortedCoachTotals;
      const visibleLessonsByCoach = isCoach
        ? buildLessonsByCoach(sortedClassRows).filter(coach => coach.id === user.id)
        : buildLessonsByCoach(sortedClassRows);
      const myCoachTotal = visibleCoachTotals[0] || {
        id: user?.id,
        name: coachNames.get(user?.id) || 'My salary',
        salary: 0,
        classes: 0,
        students: 0,
      };

      const nextSummary = {
        grossTotal,
        rentTotal,
        coachesTotal,
        earnedTotal: grossTotal - rentTotal - coachesTotal,
        coachTotals: visibleCoachTotals,
        myCoachTotal,
        classRows: sortedClassRows,
        lessonsByCoach: visibleLessonsByCoach,
      };

      setSummary(nextSummary);

      if (salarySummaryStorageKey) {
        localStorage.setItem(salarySummaryStorageKey, JSON.stringify(nextSummary));
      }
    } catch (err) {
      console.error('Failed to calculate salary:', err);
      setError('Failed to calculate salary. Check console for details.');
    } finally {
      calculationInProgress.current = false;
      setIsCalculating(false);
    }
  }, [
    coachNames,
    coaches,
    db,
    groups,
    isCoach,
    payments,
    salarySummaryStorageKey,
    selectedMonth,
    students,
    user,
  ]);

  useEffect(() => {
    if (!selectedMonth || (!isAdmin && !isCoach)) return;
    if (!groups.length || !students.length || !coaches.length) return;

    const refreshTimer = setTimeout(() => {
      calculateSalary();
    }, 300);

    return () => clearTimeout(refreshTimer);
  }, [
    calculateSalary,
    coaches.length,
    groups.length,
    isAdmin,
    isCoach,
    payments,
    selectedMonth,
    students.length,
  ]);

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
        />
        <button
          className="salary-calculate-button"
          onClick={calculateSalary}
          disabled={isCalculating}
        >
          {isCalculating ? 'Refreshing...' : summary ? 'Refresh' : 'Calculate'}
        </button>
      </div>

      {error && <p className="salary-error">{error}</p>}

      {summary && (
        <>
          {isAdmin ? (
            <div className="salary-summary">
              <div>
                <span>All earned</span>
                <strong>{summary.earnedTotal.toFixed(2)}€</strong>
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
            <h3 className="salary-heading">LESSONS</h3>
            <button
              className="salary-small-button"
              onClick={() => setShowLessonMoney(current => !current)}
            >
              {showLessonMoney ? 'Hide money' : 'Show money'}
            </button>
          </div>
          <ul className="salary-list">
            {summary.classRows.length === 0 ? (
              <li className="salary-row">No lessons in this month.</li>
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
                        onClick={() => navigate(`/group/${row.groupId}/class/${row.date}`)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            navigate(`/group/${row.groupId}/class/${row.date}`);
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
                                {(isCoach ? row.studentCount : row.earned).toFixed(2)}€
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
                  </ul>
                </li>
              ))
            )}
          </ul>
        </>
      )}
    </div>
  );
}

export default SalaryPage;
