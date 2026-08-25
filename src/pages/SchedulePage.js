import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  collection,
  documentId,
  getDocsFromServer,
  query,
  where,
} from 'firebase/firestore';
import { useNavigate } from 'react-router-dom';
import { useData } from '../context/firebase';
import { getReadCacheEpoch } from '../utils/readCacheEpoch';
import RefreshStatus from '../components/RefreshStatus';
import './SchedulePage.css';

const DAY_NAMES = ['Po', 'Ut', 'St', 'Št', 'Pi', 'So', 'Ne'];
const SCHEDULE_CACHE_TTL_MS = 5 * 60 * 1000;

// Associate in-flight reads with the shared cache instance so remounting the
// route reuses them. A new cache Map for a new user gets a fresh registry.
const scheduleRequestsByCache = new WeakMap();

function getScheduleRequests(cache) {
  let requests = scheduleRequestsByCache.get(cache);
  if (!requests) {
    requests = new Map();
    scheduleRequestsByCache.set(cache, requests);
  }
  return requests;
}

function startOfWeek(date) {
  const result = new Date(date);
  result.setHours(0, 0, 0, 0);
  result.setDate(result.getDate() - ((result.getDay() + 6) % 7));
  return result;
}

function addDays(date, amount) {
  const result = new Date(date);
  result.setDate(result.getDate() + amount);
  return result;
}

function dateKey(date) {
  return `${String(date.getDate()).padStart(2, '0')}.${String(date.getMonth() + 1).padStart(2, '0')}.${date.getFullYear()}`;
}

function groupTime(group) {
  if (group.time) return group.time;
  const match = String(group.schedule || '').match(/\b([01]?\d|2[0-3]):[0-5]\d\b/);
  return match?.[0] || 'Time TBA';
}

function classTime(classItem) {
  return classItem?.time || groupTime(classItem?.group || {});
}

function timeInMinutes(classItem) {
  const match = classTime(classItem).match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
  if (!match) return Number.POSITIVE_INFINITY;
  return Number(match[1]) * 60 + Number(match[2]);
}

function coachIds(classItem, group) {
  if (Array.isArray(classItem?.coach) && classItem.coach.length) return classItem.coach;
  return group?.coach ? [group.coach] : [];
}

function coachNickname(coach) {
  if (!coach) return '';
  const nickname = coach.nickname || coach.nickName || coach.shortName;
  if (String(nickname || '').trim()) return String(nickname).trim();

  const firstName = String(coach.name || '').trim().split(/\s+/)[0];
  if (firstName) return firstName;

  const emailNickname = String(coach.email || '').split('@')[0].trim();
  return emailNickname || coach.id;
}

function formatLoadedTime(timestamp) {
  if (!timestamp) return 'Zatiaľ neaktualizované';
  return `Aktualizované: ${new Date(timestamp).toLocaleString('sk-SK')}`;
}

function SchedulePage() {
  const navigate = useNavigate();
  const { db, groups, coaches, scheduleCache, replacementCache } = useData();
  const [view, setView] = useState('week');
  const [anchor, setAnchor] = useState(() => new Date());
  const [pastClasses, setPastClasses] = useState([]);
  const [replacements, setReplacements] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [lastLoadedAt, setLastLoadedAt] = useState(null);
  const [loadedRangeKey, setLoadedRangeKey] = useState('');
  const loadGeneration = useRef(0);

  const visibleGroups = useMemo(
    () => groups.filter(group => group.hidden !== true),
    [groups]
  );

  const visibleDates = useMemo(() => {
    if (view === 'week') {
      const first = startOfWeek(anchor);
      return Array.from({ length: 7 }, (_, index) => addDays(first, index));
    }
    const year = anchor.getFullYear();
    const month = anchor.getMonth();
    const count = new Date(year, month + 1, 0).getDate();
    return Array.from({ length: count }, (_, index) => new Date(year, month, index + 1));
  }, [anchor, view]);

  const visibleDateKeys = useMemo(() => visibleDates.map(dateKey), [visibleDates]);
  const rangeKey = useMemo(() => visibleDateKeys.join('|'), [visibleDateKeys]);
  const visibleGroupKey = useMemo(
    () => visibleGroups.map(group => group.id).sort().join('|'),
    [visibleGroups]
  );
  const displayedDataKey = `${rangeKey}::${visibleGroupKey}`;
  const rangeIsLoaded = loadedRangeKey === displayedDataKey;

  const loadClasses = useCallback(async ({ force = false } = {}) => {
    const generation = loadGeneration.current + 1;
    loadGeneration.current = generation;
    setLoading(true);
    setError('');

    try {
      const scheduleRequests = getScheduleRequests(scheduleCache);
      const results = await Promise.all(visibleGroups.map(async group => {
        const cacheKey = `${group.id}:${rangeKey}`;
        const cached = scheduleCache.get(cacheKey);
        if (
          !force &&
          cached &&
          Array.isArray(cached.classes) &&
          Array.isArray(cached.replacements) &&
          cached.scheduleEpoch === getReadCacheEpoch(scheduleCache) &&
          cached.replacementEpoch === getReadCacheEpoch(replacementCache) &&
          Date.now() - cached.fetchedAt < SCHEDULE_CACHE_TTL_MS
        ) {
          return {
            classes: cached.classes.map(item => ({ ...item, group })),
            replacements: cached.replacements.map(item => ({ ...item, group })),
            fetchedAt: cached.fetchedAt,
            scheduleEpoch: cached.scheduleEpoch,
            replacementEpoch: cached.replacementEpoch,
          };
        }

        let request = scheduleRequests.get(cacheKey);
        if (!request) {
          const readCurrentGroupRange = async () => {
            const scheduleEpoch = getReadCacheEpoch(scheduleCache);
            const replacementEpoch = getReadCacheEpoch(replacementCache);
            // Firestore permits up to 30 values in an `in` query. This fetches
            // only documents for visible dates, rather than the group's history.
            const chunks = [];
            for (let index = 0; index < visibleDateKeys.length; index += 30) {
              chunks.push(visibleDateKeys.slice(index, index + 30));
            }
            const [classSnapshots, replacementSnapshots] = await Promise.all([
              Promise.all(chunks.map(keys => getDocsFromServer(query(
                collection(db, `groups/${group.id}/pastClasses`),
                where(documentId(), 'in', keys)
              )))),
              Promise.all(chunks.map(keys => getDocsFromServer(query(
                collection(db, `groups/${group.id}/replacementSuggestions`),
                where(documentId(), 'in', keys)
              )))),
            ]);
            const classes = classSnapshots.flatMap(snapshot => snapshot.docs.map(item => ({
              id: item.id,
              ...item.data(),
              date: item.data().date || item.id,
            })));
            const groupReplacements = replacementSnapshots.flatMap(snapshot => snapshot.docs.map(item => ({
              id: item.id,
              ...item.data(),
              date: item.id,
            })));

            if (
              getReadCacheEpoch(scheduleCache) !== scheduleEpoch ||
              getReadCacheEpoch(replacementCache) !== replacementEpoch
            ) {
              // A local mutation invalidated one of these caches while the read
              // was in flight. Re-read instead of allowing the stale response to
              // restore entries that the mutation deliberately removed.
              return readCurrentGroupRange();
            }

            visibleDateKeys.forEach(key => replacementCache.set(`${group.id}:${key}`, null));
            groupReplacements.forEach(item => {
              replacementCache.set(`${group.id}:${item.id}`, { ...item, group });
            });
            const result = {
              classes,
              replacements: groupReplacements,
              fetchedAt: Date.now(),
              scheduleEpoch,
              replacementEpoch,
            };
            scheduleCache.set(cacheKey, result);
            return result;
          };
          request = readCurrentGroupRange();
          scheduleRequests.set(cacheKey, request);
        }

        try {
          const result = await request;
          return {
            classes: result.classes.map(item => ({ ...item, group })),
            replacements: result.replacements.map(item => ({ ...item, group })),
            fetchedAt: result.fetchedAt,
            scheduleEpoch: result.scheduleEpoch ?? getReadCacheEpoch(scheduleCache),
            replacementEpoch: result.replacementEpoch ?? getReadCacheEpoch(replacementCache),
          };
        } finally {
          if (scheduleRequests.get(cacheKey) === request) {
            scheduleRequests.delete(cacheKey);
          }
        }
      }));

      if (loadGeneration.current !== generation) return;
      if (results.some(result => (
        result.scheduleEpoch !== getReadCacheEpoch(scheduleCache) ||
        result.replacementEpoch !== getReadCacheEpoch(replacementCache)
      ))) {
        // One group may have completed before another group was invalidated.
        // Start a new generation so mixed pre/post-mutation results are never
        // committed to the visible schedule.
        return loadClasses();
      }
      setPastClasses(results.flatMap(result => result.classes));
      setReplacements(results.flatMap(result => result.replacements));
      setLoadedRangeKey(displayedDataKey);
      setLastLoadedAt(results.length
        ? Math.min(...results.map(result => result.fetchedAt))
        : Date.now());
    } catch (loadError) {
      console.error('Failed to load schedule:', loadError);
      if (loadGeneration.current !== generation) return;
      setError('Rozvrh sa nepodarilo načítať. Skúste to znova.');
    } finally {
      if (loadGeneration.current === generation) setLoading(false);
    }
  }, [db, displayedDataKey, rangeKey, replacementCache, scheduleCache, visibleDateKeys, visibleGroups]);

  useEffect(() => {
    loadClasses();
    return () => {
      loadGeneration.current += 1;
    };
  }, [loadClasses]);

  const coachNicknames = useMemo(
    () => new Map((coaches || []).map(coach => [coach.id, coachNickname(coach) || coach.id])),
    [coaches]
  );

  const cells = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const visiblePastClasses = rangeIsLoaded ? pastClasses : [];
    const visibleReplacements = rangeIsLoaded ? replacements : [];
    const existingByDateAndGroup = new Map(
      visiblePastClasses.map(item => [`${item.date}-${item.group.id}`, item])
    );
    const replacementByDateAndGroup = new Map(
      visibleReplacements.map(item => [`${item.date}-${item.group.id}`, item])
    );

    const dateCells = visibleDates.map(date => {
      const key = dateKey(date);
      const recorded = visiblePastClasses.filter(item => item.date === key);
      const recurring = date >= today
        ? visibleGroups
          .filter(group => (group.dayOfWeek ?? 5) === date.getDay())
          .filter(group => !existingByDateAndGroup.has(`${key}-${group.id}`))
          .map(group => ({ date: key, group, isFuture: true }))
        : [];
      const classes = [...recorded, ...recurring]
        .map(item => ({
          ...item,
          replacement: replacementByDateAndGroup.get(`${key}-${item.group.id}`) || null,
        }))
        .sort((first, second) => {
        const firstTime = timeInMinutes(first);
        const secondTime = timeInMinutes(second);
        if (firstTime !== secondTime) return firstTime - secondTime;
        return String(first.group.name || '').localeCompare(String(second.group.name || ''));
      });
      return { day: date.getDate(), date, key, classes };
    });
    if (view === 'week') return dateCells;

    const firstOffset = (visibleDates[0].getDay() + 6) % 7;
    const trailing = (7 - ((firstOffset + dateCells.length) % 7)) % 7;
    return [...Array(firstOffset).fill(null), ...dateCells, ...Array(trailing).fill(null)];
  }, [pastClasses, rangeIsLoaded, replacements, view, visibleDates, visibleGroups]);

  const changePeriod = amount => {
    setAnchor(current => view === 'week'
      ? addDays(current, amount * 7)
      : new Date(current.getFullYear(), current.getMonth() + amount, 1));
  };

  const periodLabel = view === 'month'
    ? anchor.toLocaleDateString('sk-SK', { month: 'long', year: 'numeric' })
    : `${visibleDates[0].toLocaleDateString('sk-SK', { day: 'numeric', month: 'short' })} – ${visibleDates[6].toLocaleDateString('sk-SK', { day: 'numeric', month: 'short', year: 'numeric' })}`;
  const todayKey = dateKey(new Date());

  return (
    <div className="schedule-page">
      <div className="schedule-shell">
        <RefreshStatus
          message={rangeIsLoaded ? formatLoadedTime(lastLoadedAt) : 'Zatiaľ neaktualizované'}
          error={error
            ? `${error}${rangeIsLoaded ? ` ${formatLoadedTime(lastLoadedAt)}.` : ''}`
            : ''}
          loading={loading}
          onRefresh={() => loadClasses({ force: true })}
          refreshLabel="Obnoviť rozvrh"
          loadingLabel="Obnovujem…"
        />

        <div className="schedule-view-toggle" aria-label="Zobrazenie kalendára">
          <button type="button" className={view === 'week' ? 'is-active' : ''} onClick={() => setView('week')}>Týždeň</button>
          <button type="button" className={view === 'month' ? 'is-active' : ''} onClick={() => setView('month')}>Mesiac</button>
        </div>

        <header className="schedule-header">
          <button type="button" onClick={() => navigate('/groups')} aria-label="Späť na skupiny">Späť</button>
          <div>
            <p>DancePower</p>
            <h1>ROZVRH</h1>
          </div>
          <button type="button" onClick={() => setAnchor(new Date())}>Dnes</button>
        </header>

        <div className="month-switcher">
          <button type="button" onClick={() => changePeriod(-1)} aria-label="Predchádzajúce obdobie">‹</button>
          <h2>{periodLabel}</h2>
          <button type="button" onClick={() => changePeriod(1)} aria-label="Nasledujúce obdobie">›</button>
        </div>

        {view === 'month' && (
          <div className="schedule-weekdays">
            {DAY_NAMES.map(day => <span key={day}>{day}</span>)}
          </div>
        )}

        {!rangeIsLoaded ? (
          <p className="schedule-status">
            {error || 'Načítavam rozvrh…'}
          </p>
        ) : (
          <div className={`schedule-grid schedule-grid--${view}`}>
            {cells.map((cell, index) => (
              <div key={cell?.key || `empty-${index}`} className={`schedule-day ${cell?.key === todayKey ? 'is-today' : ''} ${!cell ? 'is-empty' : ''}`}>
                {cell && (
                  <>
                    <span className="schedule-day-number">
                      {view === 'week' ? `${DAY_NAMES[(cell.date.getDay() + 6) % 7]} ${cell.day}` : cell.day}
                    </span>
                    <div className="schedule-events">
                      {cell.classes.map((item, itemIndex) => {
                        const ids = item.replacement?.status === 'confirmed'
                          ? [item.replacement.suggestedCoach]
                          : coachIds(item, item.group);
                        const names = ids.length ? ids.map(id => coachNicknames.get(id) || id).join(', ') : 'Lektor bude doplnený';
                        const replacementName = item.replacement
                          ? coachNicknames.get(item.replacement.suggestedCoach) || item.replacement.suggestedCoach
                          : '';
                        const replacementLabel = item.replacement?.status === 'confirmed'
                          ? `Zastupovanie potvrdené · ${replacementName}`
                          : item.replacement?.status === 'denied'
                            ? `Zastupovanie zamietnuté · ${replacementName}`
                            : item.replacement
                              ? `Zastupovanie čaká · ${replacementName}`
                              : '';
                        return (
                          <button
                            type="button"
                            key={`${item.group.id}-${itemIndex}`}
                            className={`schedule-event ${item.canceled ? 'is-canceled' : ''} ${item.isFuture ? 'is-future' : 'is-recorded'} ${item.replacement ? `has-replacement--${item.replacement.status}` : ''}`}
                            onClick={() => navigate(`/group/${item.group.id}/class/${cell.key}`)}
                            title={`${item.group.name} · ${classTime(item)} · ${names}`}
                          >
                            <strong>{classTime(item)}</strong>
                            <span>{item.group.name}</span>
                            <small>{item.canceled ? 'Zrušené' : names}</small>
                            {replacementLabel && <em>{replacementLabel}</em>}
                          </button>
                        );
                      })}
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
        )}

        <div className="schedule-legend">
          <span><i className="legend-recorded" /> Uskutočnená hodina</span>
          <span><i className="legend-future" /> Nadchádzajúca hodina</span>
          <span><i className="legend-pending" /> Zastupovanie čaká</span>
          <span><i className="legend-confirmed" /> Zastupovanie potvrdené</span>
          <span><i className="legend-denied" /> Zastupovanie zamietnuté</span>
        </div>
      </div>
    </div>
  );
}

export default SchedulePage;
