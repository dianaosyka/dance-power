import React, { useEffect, useMemo, useState } from 'react';
import { collection, documentId, getDocs, query, where } from 'firebase/firestore';
import { useNavigate } from 'react-router-dom';
import { useData } from '../context/firebase';
import './SchedulePage.css';

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

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

function SchedulePage() {
  const navigate = useNavigate();
  const { db, groups, coaches, scheduleCache, replacementCache } = useData();
  const [view, setView] = useState('week');
  const [anchor, setAnchor] = useState(() => new Date());
  const [pastClasses, setPastClasses] = useState([]);
  const [replacements, setReplacements] = useState([]);
  const [loading, setLoading] = useState(true);

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

  useEffect(() => {
    let active = true;
    async function loadClasses() {
      setLoading(true);
      try {
        const rangeKey = visibleDateKeys.join('|');
        const results = await Promise.all(groups.map(async group => {
          const cacheKey = `${group.id}:${rangeKey}`;
          if (scheduleCache.has(cacheKey)) return scheduleCache.get(cacheKey);

          // Firestore permits up to 30 values in an `in` query. This fetches
          // only documents for visible dates, rather than the group's history.
          const chunks = [];
          for (let index = 0; index < visibleDateKeys.length; index += 30) {
            chunks.push(visibleDateKeys.slice(index, index + 30));
          }
          const [classSnapshots, replacementSnapshots] = await Promise.all([
            Promise.all(chunks.map(keys => getDocs(query(
              collection(db, `groups/${group.id}/pastClasses`),
              where(documentId(), 'in', keys)
            )))),
            Promise.all(chunks.map(keys => getDocs(query(
              collection(db, `groups/${group.id}/replacementSuggestions`),
              where(documentId(), 'in', keys)
            )))),
          ]);
          const classes = classSnapshots.flatMap(snapshot => snapshot.docs.map(item => ({
              id: item.id,
              ...item.data(),
              date: item.data().date || item.id,
              group,
            })));
          const groupReplacements = replacementSnapshots.flatMap(snapshot => snapshot.docs.map(item => ({
            id: item.id,
            ...item.data(),
            date: item.id,
            group,
          })));
          visibleDateKeys.forEach(key => replacementCache.set(`${group.id}:${key}`, null));
          groupReplacements.forEach(item => {
            replacementCache.set(`${group.id}:${item.id}`, item);
          });
          const result = { classes, replacements: groupReplacements };
          scheduleCache.set(cacheKey, result);
          return result;
        }));
        if (active) {
          setPastClasses(results.flatMap(result => result.classes));
          setReplacements(results.flatMap(result => result.replacements));
        }
      } catch (error) {
        console.error('Failed to load schedule:', error);
        if (active) {
          setPastClasses([]);
          setReplacements([]);
        }
      } finally {
        if (active) setLoading(false);
      }
    }
    loadClasses();
    return () => { active = false; };
  }, [db, groups, visibleDateKeys, scheduleCache, replacementCache]);

  const coachNames = useMemo(
    () => new Map((coaches || []).map(coach => [coach.id, coach.name || coach.id])),
    [coaches]
  );

  const cells = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const existingByDateAndGroup = new Map(
      pastClasses.map(item => [`${item.date}-${item.group.id}`, item])
    );
    const replacementByDateAndGroup = new Map(
      replacements.map(item => [`${item.date}-${item.group.id}`, item])
    );

    const dateCells = visibleDates.map(date => {
      const key = dateKey(date);
      const recorded = pastClasses.filter(item => item.date === key);
      const recurring = date >= today
        ? groups
          .filter(group => group.hidden !== true && (group.dayOfWeek ?? 5) === date.getDay())
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
  }, [groups, pastClasses, replacements, view, visibleDates]);

  const changePeriod = amount => {
    setAnchor(current => view === 'week'
      ? addDays(current, amount * 7)
      : new Date(current.getFullYear(), current.getMonth() + amount, 1));
  };

  const periodLabel = view === 'month'
    ? anchor.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
    : `${visibleDates[0].toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} – ${visibleDates[6].toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`;
  const todayKey = dateKey(new Date());

  return (
    <div className="schedule-page">
      <div className="schedule-shell">
        <header className="schedule-header">
          <button type="button" onClick={() => navigate('/groups')} aria-label="Back to groups">←</button>
          <div>
            <p>DancePower</p>
            <h1>CLASS SCHEDULE</h1>
          </div>
          <button type="button" onClick={() => setAnchor(new Date())}>Today</button>
        </header>

        <div className="schedule-view-toggle" aria-label="Calendar view">
          <button type="button" className={view === 'week' ? 'is-active' : ''} onClick={() => setView('week')}>Weekly</button>
          <button type="button" className={view === 'month' ? 'is-active' : ''} onClick={() => setView('month')}>Monthly</button>
        </div>

        <div className="month-switcher">
          <button type="button" onClick={() => changePeriod(-1)} aria-label={`Previous ${view}`}>‹</button>
          <h2>{periodLabel}</h2>
          <button type="button" onClick={() => changePeriod(1)} aria-label={`Next ${view}`}>›</button>
        </div>

        {view === 'month' && (
          <div className="schedule-weekdays">
            {DAY_NAMES.map(day => <span key={day}>{day}</span>)}
          </div>
        )}

        {loading ? <p className="schedule-status">Loading schedule…</p> : (
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
                        const names = ids.length ? ids.map(id => coachNames.get(id) || id).join(', ') : 'Coach TBA';
                        const replacementName = item.replacement
                          ? coachNames.get(item.replacement.suggestedCoach) || item.replacement.suggestedCoach
                          : '';
                        const replacementLabel = item.replacement?.status === 'confirmed'
                          ? `Replacement confirmed · ${replacementName}`
                          : item.replacement?.status === 'denied'
                            ? `Replacement denied · ${replacementName}`
                            : item.replacement
                              ? `Replacement pending · ${replacementName}`
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
                            <small>{item.canceled ? 'Canceled' : names}</small>
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
          <span><i className="legend-recorded" /> Recorded class</span>
          <span><i className="legend-future" /> Upcoming class</span>
          <span><i className="legend-pending" /> Replacement pending</span>
          <span><i className="legend-confirmed" /> Replacement confirmed</span>
          <span><i className="legend-denied" /> Replacement denied</span>
        </div>
      </div>
    </div>
  );
}

export default SchedulePage;
