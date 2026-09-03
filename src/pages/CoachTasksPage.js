import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  collection,
  documentId,
  getDocsFromServer,
  query,
  Timestamp,
  where,
} from 'firebase/firestore';
import { useNavigate } from 'react-router-dom';
import { useData } from '../context/firebase';
import { useUser } from '../context/UserContext';
import { getReadCacheEpoch } from '../utils/readCacheEpoch';
import RefreshStatus from '../components/RefreshStatus';

const ATTENDANCE_TRACKING_START = new Date(2026, 5, 1);
const DATES_TO_CHECK = 4;
const COACH_TASKS_CACHE_TTL_MS = 5 * 60 * 1000;
const LEGACY_COMPAT_CACHE_TTL_MS = 60 * 60 * 1000;

// Keep in-flight work with the shared cache instance so route remounts can
// reuse it. Replacing the cache Map for a new user also isolates old requests.
const warningRequestsByCache = new WeakMap();

function getWarningRequests(cache) {
  let requests = warningRequestsByCache.get(cache);
  if (!requests) {
    requests = new Map();
    warningRequestsByCache.set(cache, requests);
  }
  return requests;
}

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

function isRegularCoach(group, user, includeAllWarnings = false) {
  if (includeAllWarnings && user?.role === 'admin') return true;
  const groupCoaches = Array.isArray(group.coach) ? group.coach : [group.coach];
  return groupCoaches.includes(user?.id) || user?.groups?.includes(group.id);
}

function isClassCoach(classItem, user) {
  const classCoaches = Array.isArray(classItem.coach) ? classItem.coach : [classItem.coach];
  return classCoaches.includes(user?.id);
}

function formatCheckedTime(timestamp) {
  if (!timestamp) return 'Not updated yet';
  return `Last updated: ${new Date(timestamp).toLocaleString()}`;
}

function CoachTasksPage({ includeAllWarnings = false }) {
  const { db, groups, coachTasksCache } = useData();
  const { user, accountUser, viewAsCoach } = useUser();
  const navigate = useNavigate();
  const [warnings, setWarnings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState(false);
  const [lastCheckedAt, setLastCheckedAt] = useState(null);
  const [displayedWarningKey, setDisplayedWarningKey] = useState('');
  const [errorKey, setErrorKey] = useState('');
  const latestRequestKey = useRef('');
  const activeGroups = useMemo(
    () => groups.filter(group => group.hidden !== true),
    [groups]
  );
  const canViewAllWarnings = accountUser?.role === 'admin' && !viewAsCoach;
  const allWarningsEnabled = canViewAllWarnings && includeAllWarnings;
  const warningScopeKey = useMemo(() => JSON.stringify({
    user: `${user?.role || ''}:${user?.id || ''}`,
    scope: allWarningsEnabled ? 'all' : 'mine',
    userGroups: [...(user?.groups || [])].sort(),
    today: formatDate(new Date()),
    groups: activeGroups
      .map(group => ({
        id: group.id,
        name: group.name,
        coach: Array.isArray(group.coach) ? [...group.coach].sort() : group.coach,
        dayOfWeek: group.dayOfWeek,
      }))
      .sort((first, second) => String(first.id).localeCompare(String(second.id))),
  }), [activeGroups, allWarningsEnabled, user]);

  const loadWarnings = useCallback(async ({ force = false } = {}) => {
    const cacheKey = warningScopeKey;
    latestRequestKey.current = cacheKey;

    if (!activeGroups.length) {
      const checkedAt = Date.now();
      setWarnings([]);
      setDisplayedWarningKey(cacheKey);
      setLastCheckedAt(checkedAt);
      setLoading(false);
      setError('');
      setErrorKey(cacheKey);
      return;
    }

    const cached = coachTasksCache.get(cacheKey);
    if (
      !force &&
      cached &&
      Array.isArray(cached.warnings) &&
      cached.epoch === getReadCacheEpoch(coachTasksCache) &&
      Date.now() - cached.fetchedAt < COACH_TASKS_CACHE_TTL_MS
    ) {
      setWarnings(cached.warnings);
      setDisplayedWarningKey(cacheKey);
      setLastCheckedAt(cached.fetchedAt);
      setLoading(false);
      setError('');
      setErrorKey(cacheKey);
      return;
    }

    setLoading(true);
    setError('');
    setErrorKey(cacheKey);

    const warningRequests = getWarningRequests(coachTasksCache);
    const warningRequestKey = `warnings:${cacheKey}`;
    let request = warningRequests.get(warningRequestKey);
    if (!request) {
      const runWarningRequest = async () => {
        const requestEpoch = getReadCacheEpoch(coachTasksCache);

        // Classes created before attendance tracking was added have no boolean
        // field at all, so Firestore cannot find them with `== false`. Limit this
        // compatibility scan to the post-cutoff period.
        const legacyChecks = activeGroups.map(async group => {
          const legacyCacheKey = `legacy-compat:${group.id}`;
          const cachedLegacy = coachTasksCache.get(legacyCacheKey);
          const legacyIsFresh =
            !force &&
            cachedLegacy &&
            Array.isArray(cachedLegacy.rows) &&
            cachedLegacy.epoch === requestEpoch &&
            Date.now() - cachedLegacy.fetchedAt < LEGACY_COMPAT_CACHE_TTL_MS;

          let legacyEntry = legacyIsFresh ? cachedLegacy : null;
          if (!legacyEntry) {
            const legacyRequestKey = `legacy-request:${group.id}:${requestEpoch}`;
            let legacyRequest = warningRequests.get(legacyRequestKey);
            if (!legacyRequest) {
              legacyRequest = getDocsFromServer(query(
                collection(db, `groups/${group.id}/pastClasses`),
                where('timestamp', '>=', Timestamp.fromDate(ATTENDANCE_TRACKING_START))
              )).then(snapshot => {
                const entry = {
                  rows: snapshot.docs
                    .filter(classDoc => typeof classDoc.data()?.attendanceCompleted !== 'boolean')
                    .map(classDoc => ({
                      date: classDoc.data()?.date || classDoc.id,
                      classItem: {
                        id: classDoc.id,
                        ...classDoc.data(),
                        date: classDoc.data()?.date || classDoc.id,
                      },
                    })),
                  fetchedAt: Date.now(),
                  epoch: requestEpoch,
                };
                if (getReadCacheEpoch(coachTasksCache) === requestEpoch) {
                  coachTasksCache.set(legacyCacheKey, entry);
                }
                return entry;
              });
              warningRequests.set(legacyRequestKey, legacyRequest);
            }

            try {
              legacyEntry = await legacyRequest;
            } finally {
              if (warningRequests.get(legacyRequestKey) === legacyRequest) {
                warningRequests.delete(legacyRequestKey);
              }
            }
          }

          return legacyEntry.rows.map(row => ({ group, ...row }));
        });

        // Use the existing replacement query for confirmed responsibility too.
        // This does not add another Firestore request.
        const replacementChecks = activeGroups.map(async group => {
          const snapshot = await getDocsFromServer(query(
            collection(db, `groups/${group.id}/replacementSuggestions`),
            where('status', 'in', ['pending', 'denied', 'confirmed'])
          ));
          return snapshot.docs.map(replacementDoc => ({
              group,
              date: replacementDoc.id,
              ...replacementDoc.data(),
            }));
        });

        const [legacyResultsByGroup, allReplacementResultsByGroup] = await Promise.all([
          Promise.all(legacyChecks),
          Promise.all(replacementChecks),
        ]);
        const replacementResultsByGroup = allReplacementResultsByGroup.map(rows => rows.filter(row => {
          if (allWarningsEnabled) return true;
          if (row.status === 'pending' || row.status === 'confirmed') {
            return row.suggestedCoach === user?.id;
          }
          const groupCoaches = Array.isArray(row.group.coach) ? row.group.coach : [row.group.coach];
          return row.status === 'denied' && groupCoaches.includes(user?.id);
        }));
        const confirmedReplacementDatesByGroup = new Map();
        const responsibleConfirmedDatesByGroup = new Map();
        allReplacementResultsByGroup.flat().forEach(({ group, date, status, suggestedCoach }) => {
          if (status !== 'confirmed') return;
          const dates = confirmedReplacementDatesByGroup.get(group.id) || new Set();
          dates.add(date);
          confirmedReplacementDatesByGroup.set(group.id, dates);
          if (allWarningsEnabled || suggestedCoach === user?.id) {
            const responsibleDates = responsibleConfirmedDatesByGroup.get(group.id) || new Set();
            responsibleDates.add(date);
            responsibleConfirmedDatesByGroup.set(group.id, responsibleDates);
          }
        });

        // Keep these as simple single-field/default-index queries. The previous
        // combined OR query was rejected by the deployed Firestore setup.
        const incompleteChecks = activeGroups.map(async group => {
          const snapshot = await getDocsFromServer(query(
            collection(db, `groups/${group.id}/pastClasses`),
            where('attendanceCompleted', '==', false)
          ));
          return snapshot.docs.map(classDoc => {
            const data = classDoc.data();
            return {
              group,
              date: data?.date || classDoc.id,
              classItem: {
                id: classDoc.id,
                ...data,
                date: data?.date || classDoc.id,
              },
            };
          });
        });

        const recentChecks = activeGroups.map(async group => {
          const expectedDates = getRecentExpectedDates(group.dayOfWeek ?? 5);
          const oldestExpectedDate = parseDate(expectedDates[expectedDates.length - 1]);
          const today = new Date();
          today.setHours(0, 0, 0, 0);
          const confirmedDates = [...(responsibleConfirmedDatesByGroup.get(group.id) || [])]
            .filter(confirmedDate => {
              const parsed = parseDate(confirmedDate);
              return !Number.isNaN(parsed.getTime()) && parsed >= oldestExpectedDate && parsed <= today;
            });
          const responsibilityDates = new Set([
            ...(isRegularCoach(group, user, allWarningsEnabled)
              ? expectedDates.filter(date => !confirmedReplacementDatesByGroup.get(group.id)?.has(date))
              : []),
            ...confirmedDates,
          ]);
          if (responsibilityDates.size === 0) return [];

          const snapshot = await getDocsFromServer(query(
            collection(db, `groups/${group.id}/pastClasses`),
            where(documentId(), 'in', [...responsibilityDates])
          ));
          const classesByDate = new Map(snapshot.docs.flatMap(classDoc => {
            const data = classDoc.data();
            const classItem = {
              id: classDoc.id,
              ...data,
              date: data?.date || classDoc.id,
            };
            return [
              [classDoc.id, classItem],
              [classItem.date, classItem],
            ];
          }));

          return [...responsibilityDates].map(responsibilityDate => ({
            group,
            date: responsibilityDate,
            classItem: classesByDate.get(responsibilityDate) || null,
          }));
        });
        const [incompleteResultsByGroup, recentResultsByGroup] = await Promise.all([
          Promise.all(incompleteChecks),
          Promise.all(recentChecks),
        ]);
        const results = [
          ...incompleteResultsByGroup.flat(),
          ...recentResultsByGroup.flat(),
          ...legacyResultsByGroup.flat(),
        ];
        const warningByKey = new Map();
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        results.forEach(({ group, date, classItem }) => {
          const regularCoach = isRegularCoach(group, user, allWarningsEnabled);

          if (!classItem) {
            const isConfirmedReplacement = confirmedReplacementDatesByGroup
              .get(group.id)
              ?.has(date);
            if (regularCoach || isConfirmedReplacement) {
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
          if (status === 'confirmed') return;
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
        if (getReadCacheEpoch(coachTasksCache) !== requestEpoch) {
          return runWarningRequest();
        }
        const cacheEntry = {
          warnings: nextWarnings,
          fetchedAt: Date.now(),
          epoch: requestEpoch,
        };
        coachTasksCache.set(cacheKey, cacheEntry);
        return cacheEntry;
      };
      request = runWarningRequest();
      warningRequests.set(warningRequestKey, request);
    }

    try {
      const result = await request;
      if (latestRequestKey.current !== cacheKey) return;
      if (result.epoch !== getReadCacheEpoch(coachTasksCache)) {
        // An invalidation can land in the small microtask window after the
        // request's final epoch check but before this component applies it.
        // Detach that completed request and reload instead of flashing stale
        // warnings back into the UI.
        if (warningRequests.get(warningRequestKey) === request) {
          warningRequests.delete(warningRequestKey);
        }
        return loadWarnings({ force });
      }
      setWarnings(result.warnings);
      setDisplayedWarningKey(cacheKey);
      setLastCheckedAt(result.fetchedAt);
      if (result.warnings.length === 0) setExpanded(false);
    } catch (err) {
      console.error('Failed to load coach warnings:', err);
      if (latestRequestKey.current !== cacheKey) return;
      setError('Warnings could not be loaded. Please try again.');
      setErrorKey(cacheKey);
    } finally {
      if (warningRequests.get(warningRequestKey) === request) {
        warningRequests.delete(warningRequestKey);
      }
      if (latestRequestKey.current === cacheKey) setLoading(false);
    }
  }, [activeGroups, allWarningsEnabled, coachTasksCache, db, user, warningScopeKey]);

  useEffect(() => {
    loadWarnings();
  }, [loadWarnings]);

  const displayedWarnings = displayedWarningKey === warningScopeKey ? warnings : [];
  const displayedError = errorKey === warningScopeKey ? error : '';
  const displayedLastCheckedAt = displayedWarningKey === warningScopeKey
    ? lastCheckedAt
    : null;
  const scopeLoading = loading || (
    displayedWarningKey !== warningScopeKey && !displayedError
  );

  if (!canViewAllWarnings && !scopeLoading && !displayedError && displayedWarnings.length === 0) {
    return null;
  }

  return (
    <section className="main-warnings" aria-label="Coach warnings">
      <RefreshStatus
        message={formatCheckedTime(displayedLastCheckedAt)}
        error={displayedError
          ? `${displayedError} · ${formatCheckedTime(displayedLastCheckedAt)}`
          : ''}
        loading={scopeLoading}
        onRefresh={() => loadWarnings({ force: true })}
        refreshLabel={displayedError ? 'Try again' : 'Refresh warnings'}
        loadingLabel={displayedError ? 'Trying…' : 'Refreshing…'}
      />
      {displayedWarnings.length > 0 && (
        <button
          type="button"
          className="warnings-summary"
          aria-expanded={expanded}
          onClick={() => setExpanded(current => !current)}
        >
          <span aria-hidden="true">⚠️</span>
          <span>
            <strong>
              {displayedWarnings.length} {displayedWarnings.length === 1 ? 'warning needs' : 'warnings need'} attention
            </strong>
            <small>{expanded ? 'Hide warnings' : 'Resolve them'}</small>
          </span>
          <span aria-hidden="true">{expanded ? '▲' : '▼'}</span>
        </button>
      )}

      {expanded && displayedWarnings.length > 0 && (
        <ul>
          {displayedWarnings.map(warning => (
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
      )}
    </section>
  );
}

export default CoachTasksPage;
