import React, { useMemo, useState } from 'react';
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
  const [selectedMonth, setSelectedMonth] = useState(getCurrentMonthValue());
  const [isCalculating, setIsCalculating] = useState(false);
  const [summary, setSummary] = useState(null);
  const [error, setError] = useState('');
  const [showLessonMoney, setShowLessonMoney] = useState(false);

  const coachNames = useMemo(
    () => new Map((coaches || []).map(coach => [coach.id, coach.name || coach.id])),
    [coaches]
  );

  const calculateSalary = async () => {
    if (!selectedMonth || isCalculating) return;

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
          const rent = Number(classData?.rent || 0);
          const coachIds = getCoachIdsForClass(classData, group);
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
            groupName: group.name,
            date,
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

      setSummary({
        grossTotal,
        rentTotal,
        coachesTotal,
        earnedTotal: grossTotal - rentTotal - coachesTotal,
        coachTotals: [...coachTotals.values()]
          .filter(coach => coach.salary > 0 || coach.classes > 0)
          .sort((a, b) => b.salary - a.salary),
        classRows: sortedClassRows,
        lessonsByCoach: buildLessonsByCoach(sortedClassRows),
      });
    } catch (err) {
      console.error('Failed to calculate salary:', err);
      setError('Failed to calculate salary. Check console for details.');
    } finally {
      setIsCalculating(false);
    }
  };

  if (user?.role !== 'admin') {
    return (
      <div className="salary-page">
        <button className="salary-back-button" onClick={() => navigate('/groups')}>
          Back
        </button>
        <h2>Salary</h2>
        <p>Only admins can see this page.</p>
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
          {isCalculating ? 'Calculating...' : 'Calculate'}
        </button>
      </div>

      {error && <p className="salary-error">{error}</p>}

      {summary && (
        <>
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

          <h3 className="salary-heading">COACHES</h3>
          <ul className="salary-list">
            {summary.coachTotals.length === 0 ? (
              <li className="salary-row">No coach salary in this month.</li>
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
                      <li key={`${coach.id}-${row.id}`} className="salary-lesson-row">
                        <div>
                          <strong>{row.date}</strong>
                          <span>{row.groupName}</span>
                        </div>
                        <div>
                          <span>{row.studentCount} people</span>
                          {showLessonMoney && <strong>{row.earned.toFixed(2)}€</strong>}
                        </div>
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
