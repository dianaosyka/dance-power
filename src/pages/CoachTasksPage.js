import React, { useCallback, useEffect, useState } from 'react';
import { collection, doc, getDoc, getDocs, query, Timestamp, where } from 'firebase/firestore';
import { useNavigate } from 'react-router-dom';
import { useData } from '../context/firebase';
import { useUser } from '../context/UserContext';

const ATTENDANCE_TRACKING_START = new Date(2026, 5, 1);
const DATES_TO_CHECK = 4;

function formatDate(date) {
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  return `${dd}.${mm}.${date.getFullYear()}`;
}

function parseDate(dateStr) {
  const [dd, mm, yyyy] = String(dateStr || '').split('.').map(Number);
  return new Date(yyyy, mm - 1, dd);
}

function getRecentExpectedDates(weekday) {
  const dates = [];
  const cursor = new Date();
  cursor.setHours(0, 0, 0, 0);

  while (dates.length < DATES_TO_CHECK) {
    if (cursor.getDay() === weekday) dates.push(formatDate(cursor));
    cursor.setDate(cursor.getDate() - 1);
  }
  return dates;
}

function isComplete(classItem) {
  if (classItem.attendanceCompleted === true) return true;
  if (classItem.attendanceCompleted === false) return false;
  return parseDate(classItem.date) < ATTENDANCE_TRACKING_START;
}

function isRegularCoach(group, user) {
  if (user?.role === 'admin') return true;
  const groupCoaches = Array.isArray(group.coach) ? group.coach : [group.coach];
  return groupCoaches.includes(user?.id) || user?.groups?.includes(group.id);
}

function isClassCoach(classItem, user) {
  const classCoaches = Array.isArray(classItem.coach) ? classItem.coach : [classItem.coach];
  return classCoaches.includes(user?.id);
}

function CoachTasksPage() {
  const { db, groups, coachTasksCache } = useData();
  const { user } = useUser();
  const navigate = useNavigate();
  const [warnings, setWarnings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState(false);

  const loadWarnings = useCallback(async ({ force = false } = {}) => {
    const activeGroups = groups.filter(group => group.hidden !== true);
    const cacheKey = JSON.stringify({
      user: `${user?.role || ''}:${user?.id || ''}`,
      groups: activeGroups.map(group => ({
        id: group.id,
        coach: group.coach,
        dayOfWeek: group.dayOfWeek,
      })),
    });

    if (!activeGroups.length) {
      setWarnings([]);
      setLoading(false);
      return;
    }

    if (!force && coachTasksCache.has(cacheKey)) {
      setWarnings(coachTasksCache.get(cacheKey));
      setLoading(false);
      setError('');
      return;
    }

    setLoading(true);
    setError('');
    try {
      // Four targeted document reads per group keeps the cost predictable and
      // avoids downloading each group's complete class history.
      const recentChecks = activeGroups.flatMap(group =>
        getRecentExpectedDates(group.dayOfWeek ?? 5).map(async date => {
          const snapshot = await getDoc(doc(db, `groups/${group.id}/pastClasses`, date));
          return {
            group,
            date,
            classItem: snapshot.exists()
              ? { id: snapshot.id, ...snapshot.data(), date }
              : null,
          };
        })
      );

      // This query returns only unresolved documents, so old completed classes
      // do not consume reads. An unresolved class stays visible until handled.
      const incompleteChecks = activeGroups.map(async group => {
        const snapshot = await getDocs(query(
          collection(db, `groups/${group.id}/pastClasses`),
          where('attendanceCompleted', '==', false)
        ));
        return snapshot.docs.map(classDoc => ({
          group,
          date: classDoc.data()?.date || classDoc.id,
          classItem: {
            id: classDoc.id,
            ...classDoc.data(),
            date: classDoc.data()?.date || classDoc.id,
          },
        }));
      });

      // Classes created before attendance tracking was added have no boolean
      // field at all, so Firestore cannot find them with `== false`. Limit this
      // compatibility scan to the post-cutoff period.
      const legacyChecks = activeGroups.map(async group => {
        const snapshot = await getDocs(query(
          collection(db, `groups/${group.id}/pastClasses`),
          where('timestamp', '>=', Timestamp.fromDate(ATTENDANCE_TRACKING_START))
        ));
        return snapshot.docs
          .filter(classDoc => typeof classDoc.data()?.attendanceCompleted !== 'boolean')
          .map(classDoc => ({
            group,
            date: classDoc.data()?.date || classDoc.id,
            classItem: {
              id: classDoc.id,
              ...classDoc.data(),
              date: classDoc.data()?.date || classDoc.id,
            },
          }));
      });

      // Query only unresolved replacement requests within each known group.
      // This works with the app's existing nested-collection permissions and
      // does not require a collection-group composite index.
      const replacementConfirmations = activeGroups.map(async group => {
        const snapshot = await getDocs(query(
          collection(db, `groups/${group.id}/replacementSuggestions`),
          where('status', 'in', ['pending', 'denied'])
        ));
        return snapshot.docs
          .filter(replacementDoc => {
            const data = replacementDoc.data();
            if (data?.status === 'pending') return data.suggestedCoach === user.id;
            const groupCoaches = Array.isArray(group.coach) ? group.coach : [group.coach];
            return data?.status === 'denied' && groupCoaches.includes(user.id);
          })
          .map(replacementDoc => ({
            group,
            date: replacementDoc.id,
            status: replacementDoc.data()?.status,
          }));
      });

      const [recentResults, incompleteResultsByGroup, legacyResultsByGroup, replacementResultsByGroup] = await Promise.all([
        Promise.all(recentChecks),
        Promise.all(incompleteChecks),
        Promise.all(legacyChecks),
        Promise.all(replacementConfirmations),
      ]);
      const results = [
        ...recentResults,
        ...incompleteResultsByGroup.flat(),
        ...legacyResultsByGroup.flat(),
      ];
      const warningByKey = new Map();
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      results.forEach(({ group, date, classItem }) => {
        const regularCoach = isRegularCoach(group, user);

        if (!classItem) {
          if (regularCoach) {
            const warning = { type: 'missing', groupId: group.id, groupName: group.name, date };
            warningByKey.set(`missing-${group.id}-${date}`, warning);
          }
          return;
        }

        if (
          !classItem.canceled &&
          !isComplete(classItem) &&
          parseDate(classItem.date) < today &&
          (regularCoach || isClassCoach(classItem, user))
        ) {
          const warning = { type: 'attendance', groupId: group.id, groupName: group.name, date };
          warningByKey.set(`attendance-${group.id}-${date}`, warning);
        }
      });

      replacementResultsByGroup.flat().forEach(({ group, date, status }) => {
        const groupId = group.id;
        const type = status === 'denied' ? 'replacement-denied' : 'replacement';
        warningByKey.set(`${type}-${groupId}-${date}`, {
          type,
          groupId,
          groupName: group.name,
          date,
        });
      });

      const nextWarnings = [...warningByKey.values()];
      nextWarnings.sort((a, b) => parseDate(b.date) - parseDate(a.date));
      coachTasksCache.set(cacheKey, nextWarnings);
      setWarnings(nextWarnings);
    } catch (err) {
      console.error('Failed to load coach warnings:', err);
      setError('Warnings could not be loaded. Please try again.');
      setWarnings([]);
    } finally {
      setLoading(false);
    }
  }, [coachTasksCache, db, groups, user]);

  useEffect(() => {
    loadWarnings();
  }, [loadWarnings]);

  if (loading) return null;

  if (!error && warnings.length === 0) return null;

  return (
    <section className="main-warnings" aria-label="Coach warnings">
      {error ? (
        <div className="warnings-error">
          <span>{error}</span>
          <button type="button" onClick={() => loadWarnings({ force: true })}>Try again</button>
        </div>
      ) : (
        <>
          <button
            type="button"
            className="warnings-summary"
            aria-expanded={expanded}
            onClick={() => setExpanded(current => !current)}
          >
            <span aria-hidden="true">⚠️</span>
            <span>
              <strong>{warnings.length} {warnings.length === 1 ? 'warning needs' : 'warnings need'} attention</strong>
              <small>{expanded ? 'Hide warnings' : 'Resolve them'}</small>
            </span>
            <span aria-hidden="true">{expanded ? '▲' : '▼'}</span>
          </button>

          {expanded && (
            <>
              <div className="warnings-heading">
                <span>Action needed</span>
                <button type="button" onClick={() => loadWarnings({ force: true })}>Refresh</button>
              </div>
              <ul>
                {warnings.map(warning => (
                  <li
                    key={`${warning.type}-${warning.groupId}-${warning.date}`}
                    className={`main-warning main-warning--${warning.type}`}
                  >
                    <button
                      type="button"
                      onClick={() => navigate(
                        warning.type === 'missing'
                          ? `/group/${warning.groupId}`
                          : `/group/${warning.groupId}/class/${warning.date}`
                      )}
                    >
                      <span className="main-warning-icon" aria-hidden="true">
                        {warning.type === 'missing'
                          ? '🚫'
                          : warning.type === 'replacement'
                            ? '🔄'
                            : warning.type === 'replacement-denied'
                              ? '✕'
                              : '⚠️'}
                      </span>
                      <span>
                        <strong>{warning.groupName}</strong>
                        <small>{warning.date} · {
                          warning.type === 'missing'
                            ? 'Class was not added'
                            : warning.type === 'replacement'
                              ? 'Confirm replacement request'
                              : warning.type === 'replacement-denied'
                                ? 'Replacement was denied — acknowledge it'
                              : 'Attendance is not complete'
                        }</small>
                      </span>
                      <span aria-hidden="true">➔</span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </section>
  );
}

export default CoachTasksPage;
