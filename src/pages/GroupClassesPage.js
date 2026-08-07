import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import {
  collection,
  getDocsFromServer,
  doc,
  runTransaction,
  Timestamp,
  writeBatch,
  arrayRemove,
  query,
  where,
} from 'firebase/firestore';
import { useData } from '../context/firebase';
import { useUser } from '../context/UserContext';
import { invalidateSalarySummaries } from '../utils/salaryCache';
import { invalidateReadCache } from '../utils/readCacheEpoch';
import RefreshStatus from '../components/RefreshStatus';
import './GroupClassesPage.css';

function getNextFutureDates(startFrom, weekday, count) {
  const result = [];
  const date = new Date(startFrom);

  while (result.length < count) {
    if (date.getDay() === weekday) {
      const dd = String(date.getDate()).padStart(2, '0');
      const mm = String(date.getMonth() + 1).padStart(2, '0');
      const yyyyStr = date.getFullYear();
      result.push(`${dd}.${mm}.${yyyyStr}`);
    }
    date.setDate(date.getDate() + 1);
  }

  return result;
}

function parseDateStr(dateStr) {
  if (!dateStr) return new Date(0);
  const [dd, mm, yyyy] = dateStr.split('.').map(Number);
  return new Date(yyyy, mm - 1, dd);
}

const ATTENDANCE_TRACKING_START = new Date(2026, 5, 1);

function isAttendanceComplete(classItem) {
  if (classItem.attendanceCompleted === true) return true;
  if (classItem.attendanceCompleted === false) return false;
  return parseDateStr(classItem.date) < ATTENDANCE_TRACKING_START;
}

function formatDate(date) {
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  return `${dd}.${mm}.${date.getFullYear()}`;
}

function toDateInputValue(dateStr) {
  const [dd, mm, yyyy] = dateStr.split('.');
  return `${yyyy}-${mm}-${dd}`;
}

function mapPastClassDocs(docs) {
  return docs
    .map(d => {
      const data = d.data();
      return {
        id: d.id,
        ...data,
        date: data?.date || d.id,
      };
    })
    .sort((a, b) => parseDateStr(b.date) - parseDateStr(a.date));
}

const MAX_ATOMIC_BATCH_OPERATIONS = 500;
const SAFE_BATCH_CHUNK_SIZE = 450;
const MAX_GROUP_DELETION_RECONCILIATION_PASSES = 5;

async function readGroupCleanupOperations(db, groupId) {
  const pastClassesRef = collection(db, `groups/${groupId}/pastClasses`);
  const affectedStudentsQuery = query(
    collection(db, 'students'),
    where('groups', 'array-contains', groupId)
  );
  const affectedPaymentsQuery = query(
    collection(db, 'payments'),
    where('groups', 'array-contains', groupId)
  );
  const [pastClassesSnap, studentsSnap, paymentsSnap] = await Promise.all([
    getDocsFromServer(pastClassesRef),
    getDocsFromServer(affectedStudentsQuery),
    getDocsFromServer(affectedPaymentsQuery),
  ]);

  const cleanupOperations = [];
  pastClassesSnap.forEach((classDoc) => {
    cleanupOperations.push(batch => batch.delete(classDoc.ref));
  });
  studentsSnap.forEach((studentDoc) => {
    cleanupOperations.push(batch => batch.update(studentDoc.ref, {
      groups: arrayRemove(groupId),
    }));
  });
  paymentsSnap.forEach((paymentDoc) => {
    cleanupOperations.push(batch => batch.update(paymentDoc.ref, {
      groups: arrayRemove(groupId),
    }));
  });

  return cleanupOperations;
}

async function commitCleanupChunks(db, cleanupOperations, onChunkCommitted) {
  for (let index = 0; index < cleanupOperations.length; index += SAFE_BATCH_CHUNK_SIZE) {
    const operations = cleanupOperations.slice(index, index + SAFE_BATCH_CHUNK_SIZE);
    const batch = writeBatch(db);
    operations.forEach(applyOperation => applyOperation(batch));
    await batch.commit();
    onChunkCommitted(operations.length);
  }
}

async function commitGroupDeletion(db, groupId, cleanupOperations, groupRef) {
  if (cleanupOperations.length + 1 <= MAX_ATOMIC_BATCH_OPERATIONS) {
    const batch = writeBatch(db);
    cleanupOperations.forEach(applyOperation => applyOperation(batch));
    batch.delete(groupRef);
    await batch.commit();
    return;
  }

  // A cleanup larger than Firestore's atomic batch limit necessarily spans
  // commits. Keep the group document until fresh server queries find a final
  // set small enough to clean up atomically with the group deletion. This also
  // catches references/classes created while an earlier chunk was committing.
  let committedCleanupOperations = 0;
  const recordCommittedOperations = committedCount => {
    committedCleanupOperations += committedCount;
  };

  try {
    await commitCleanupChunks(db, cleanupOperations, recordCommittedOperations);

    for (
      let pass = 0;
      pass < MAX_GROUP_DELETION_RECONCILIATION_PASSES;
      pass += 1
    ) {
      const remainingOperations = await readGroupCleanupOperations(db, groupId);

      if (remainingOperations.length + 1 <= MAX_ATOMIC_BATCH_OPERATIONS) {
        const finalBatch = writeBatch(db);
        remainingOperations.forEach(applyOperation => applyOperation(finalBatch));
        finalBatch.delete(groupRef);
        await finalBatch.commit();
        return;
      }

      await commitCleanupChunks(db, remainingOperations, recordCommittedOperations);
    }

    throw new Error(
      'The group kept receiving new references while deletion was running.'
    );
  } catch (error) {
    const deletionError = new Error(error?.message || String(error));
    deletionError.cause = error;
    deletionError.partialCleanupCommitted = committedCleanupOperations > 0;
    deletionError.committedCleanupOperations = committedCleanupOperations;
    throw deletionError;
  }
}

// Only inspect a short recent window. This catches forgotten lessons without
// making old data from before the app was introduced appear as unfinished.
function getRecentExpectedDates(weekday, count = 4) {
  const result = [];
  const cursor = new Date();
  cursor.setHours(0, 0, 0, 0);

  while (result.length < count) {
    if (cursor.getDay() === weekday) result.push(formatDate(cursor));
    cursor.setDate(cursor.getDate() - 1);
  }

  return result;
}

function GroupClassesPage() {
  const { groupId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const requestedAddClassDate = location.state?.addClassDate;
  const requestedCoachId = location.state?.replacementCoachId;
  const {
    groups,
    db,
    coaches,
    loadPastClassDocs,
    updateCachedClass,
    invalidatePastClasses,
    scheduleCache,
    coachTasksCache,
    removeGroupFromCachedRecords,
  } = useData();
  const { user } = useUser();

  const [group, setGroup] = useState(null);
  const [pastDates, setPastDates] = useState([]);
  const [pastClassesLoaded, setPastClassesLoaded] = useState(false);
  const [pastClassesLoading, setPastClassesLoading] = useState(false);
  const [pastClassesError, setPastClassesError] = useState('');
  const [pastClassesCheckedAt, setPastClassesCheckedAt] = useState(null);
  const [futureDates, setFutureDates] = useState([]);
  const [selectedDate, setSelectedDate] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [showFuture, setShowFuture] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);

  const [newDate, setNewDate] = useState('');
  const [newTime, setNewTime] = useState('');
  const [newRent, setNewRent] = useState(0);
  const [newCanceled, setNewCanceled] = useState(false);
  const [newCoach, setNewCoach] = useState('');

  // guards
  const [isToggling, setIsToggling] = useState(false);
  const [isAdding, setIsAdding] = useState(false);
  const [isDeletingGroup, setIsDeletingGroup] = useState(false);
  const pastClassLoadGeneration = useRef(0);
  const groupDeletionInProgress = useRef(false);
  const canManageClasses = user?.role === 'admin' || user?.role === 'coach';

  const warnings = useMemo(() => {
    if (!group || group.hidden === true || !pastClassesLoaded) return [];

    const classByDate = new Map(pastDates.map(item => [item.date, item]));
    const missingWarnings = getRecentExpectedDates(group.dayOfWeek ?? 5).flatMap(date => {
      const classItem = classByDate.get(date);

      if (!classItem) {
        return [{ type: 'missing', date, message: 'Class was not added' }];
      }
      return [];
    });

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const attendanceWarnings = pastDates
      .filter(classItem => (
        !classItem.canceled &&
        !isAttendanceComplete(classItem) &&
        parseDateStr(classItem.date) < today
      ))
      .map(classItem => ({
        type: 'attendance',
        date: classItem.date,
        message: 'Attendance is not completed',
      }));

    return [...missingWarnings, ...attendanceWarnings];
  }, [group, pastDates, pastClassesLoaded]);

  useEffect(() => {
    const g = groups.find(g => g.id === groupId);
    setGroup(g);
  }, [groupId, groups]);

  useEffect(() => {
    let active = true;
    const generation = pastClassLoadGeneration.current + 1;
    pastClassLoadGeneration.current = generation;

    const fetchPastClasses = async () => {
      if (!groupId) return;
      setPastClassesLoaded(false);
      setPastClassesLoading(true);
      setPastClassesError('');
      setPastDates([]);

      try {
        const docs = await loadPastClassDocs(groupId);
        const fetched = mapPastClassDocs(docs);
        if (active && pastClassLoadGeneration.current === generation) {
          setPastDates(fetched);
          setPastClassesLoaded(true);
          setPastClassesCheckedAt(Date.now());
        }
      } catch (err) {
        console.error('Failed to load classes:', err);
        if (active && pastClassLoadGeneration.current === generation) {
          setPastDates([]);
          setPastClassesLoaded(false);
          setPastClassesError('Classes could not be loaded. Please try again.');
        }
      } finally {
        if (active && pastClassLoadGeneration.current === generation) {
          setPastClassesLoading(false);
        }
      }
    };

    fetchPastClasses();
    return () => {
      active = false;
      pastClassLoadGeneration.current += 1;
    };
  }, [groupId, loadPastClassDocs]);

  const handleRefreshPastClasses = async () => {
    if (!groupId || pastClassesLoading) return;

    const generation = pastClassLoadGeneration.current + 1;
    pastClassLoadGeneration.current = generation;
    setPastClassesLoading(true);
    setPastClassesError('');
    try {
      const docs = await loadPastClassDocs(groupId, { force: true });
      if (pastClassLoadGeneration.current !== generation) return;
      setPastDates(mapPastClassDocs(docs));
      setPastClassesLoaded(true);
      setPastClassesCheckedAt(Date.now());
    } catch (err) {
      console.error('Failed to refresh classes:', err);
      if (pastClassLoadGeneration.current !== generation) return;
      setPastClassesError('Classes could not be refreshed. Please try again.');
      alert('❌ Failed to refresh classes');
    } finally {
      if (pastClassLoadGeneration.current === generation) {
        setPastClassesLoading(false);
      }
    }
  };

  const toggleFutureDates = () => {
    if (!group) return;
    if (showFuture) {
      setShowFuture(false);
      return;
    }

    const weekday = group.dayOfWeek ?? 5;
    const start = new Date();
    const future = getNextFutureDates(start, weekday, 10);
    setFutureDates(future);
    setShowFuture(true);
  };

  const handleToggleCancel = async () => {
    if (!canManageClasses || !selectedDate || !groupId || isToggling) return;

    setIsToggling(true);
    const ref = doc(db, `groups/${groupId}/pastClasses`, selectedDate);

    try {
      // Atomic flip on the server to avoid race/double-click
      const newStatus = await runTransaction(db, async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists()) {
          throw new Error('Class document does not exist.');
        }
        const current = !!snap.data().canceled;
        tx.update(ref, {
          canceled: !current,
          timestamp: Timestamp.now(),
        });
        return !current;
      });

      // Reflect locally
      setPastDates(prev =>
        prev.map(p =>
          p.date === selectedDate ? { ...p, canceled: newStatus } : p
        )
      );
      updateCachedClass(groupId, selectedDate, {
        canceled: newStatus,
        timestamp: Timestamp.now(),
      });
      invalidateReadCache(scheduleCache);
      invalidateReadCache(coachTasksCache);
      invalidateSalarySummaries();
    } catch (err) {
      console.error('Error toggling canceled status:', err);
      alert('❌ Failed to toggle class status.');
    } finally {
      setIsToggling(false);
      setShowModal(false);
      setSelectedDate(null);
    }
  };

  const handleAddClass = async () => {
    if (!canManageClasses || isAdding) return;
    if (!groupId || !newDate || !newCoach) {
      alert('Please fill in all fields');
      return;
    }

    const [yyyy, mm, dd] = newDate.split('-');
    const formattedDate = `${dd}.${mm}.${yyyy}`;
    const ref = doc(db, `groups/${groupId}/pastClasses`, formattedDate);

    setIsAdding(true);
    try {
      // Create only if not exists (atomic)
      const classData = {
        date: formattedDate,
        ...(newTime ? { time: newTime } : {}),
        coach: [newCoach],
        rent: Number(newRent),
        canceled: Boolean(newCanceled),
        attendanceCompleted: false,
        timestamp: Timestamp.now(),
      };
      await runTransaction(db, async (tx) => {
        const snap = await tx.get(ref);
        if (snap.exists()) {
          throw new Error('This class date already exists.');
        }
        tx.set(ref, classData);
      });
      updateCachedClass(groupId, formattedDate, classData);
      invalidateReadCache(scheduleCache);
      invalidateReadCache(coachTasksCache);
      invalidateSalarySummaries();

      // Optionally refresh list immediately (or keep navigate)
      // Navigate back to list
      setShowAddForm(false);
      setNewDate('');
      setNewTime('');
      setNewRent(0);
      setNewCanceled(false);
      setNewCoach('');
      navigate(`/groups`);
    } catch (err) {
      console.error(err);
      alert(`❌ Error adding class: ${err.message || 'Unknown error'}`);
    } finally {
      setIsAdding(false);
    }
  };

  const openAddClassForm = (date = '', coachId = '') => {
    setNewDate(date ? toDateInputValue(date) : '');
    setNewTime('');
    setNewCoach(coachId || group?.coach || '');
    setShowAddForm(true);
  };

  useEffect(() => {
    const dateToAdd = requestedAddClassDate;
    if (!dateToAdd || !group) return;

    openAddClassForm(dateToAdd, requestedCoachId);
    navigate(location.pathname, { replace: true, state: null });
  // The navigation state is cleared immediately after it is handled.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [group, requestedAddClassDate, requestedCoachId]);

  const handleDeleteGroup = async () => {
    if (
      user?.role !== 'admin' ||
      !groupId ||
      !group ||
      isDeletingGroup ||
      groupDeletionInProgress.current
    ) return;

    if (!window.confirm(`Delete group ${group.name}? This will also delete all past classes.`)) {
      return;
    }

    const second = prompt(`Type DELETE to permanently remove ${group.name}.`);
    if (second !== 'DELETE') {
      alert('❌ Deletion canceled');
      return;
    }

    groupDeletionInProgress.current = true;
    setIsDeletingGroup(true);

    try {
      const cleanupOperations = await readGroupCleanupOperations(db, groupId);

      await commitGroupDeletion(
        db,
        groupId,
        cleanupOperations,
        doc(db, 'groups', groupId)
      );
      removeGroupFromCachedRecords(groupId);
      invalidateSalarySummaries();

      alert('✅ Group deleted');
      navigate('/groups');
    } catch (err) {
      console.error('Error deleting group:', err);
      // A failed multi-batch deletion can still have committed some cleanup
      // writes. Drop derived caches so those writes are never hidden behind a
      // locally "fresh" class/task/salary result.
      invalidatePastClasses(groupId);
      invalidateReadCache(scheduleCache);
      invalidateReadCache(coachTasksCache);
      invalidateSalarySummaries();
      if (err?.partialCleanupCommitted) {
        alert(
          `❌ Group deletion stopped after ${err.committedCleanupOperations} cleanup ` +
          'updates/deletions were already committed. This client could not confirm the ' +
          'final group deletion, so some class records or group links may already ' +
          'be removed. Refresh, verify the group, and retry to finish reconciliation.'
        );
      } else {
        alert(
          '❌ Group deletion failed before this client confirmed any cleanup write. ' +
          'Refresh to verify the current server state before retrying.'
        );
      }
    } finally {
      groupDeletionInProgress.current = false;
      setIsDeletingGroup(false);
    }
  };

  return (
    <div className="group-page">
      <h2 className="group-title">{group?.name?.toUpperCase()}</h2>
      <p className="group-schedule">{group?.schedule || 'FRIDAY 20:00'}</p>

      {(user?.role === 'admin' || user?.role === 'coach') && (
        <>
          <button className="students-button" onClick={() => navigate('/students')}>
            STUDENTS LIST
          </button>
          <button
            className="add-cancel-button"
            onClick={() => openAddClassForm()}
            style={{ backgroundColor: 'green', color: 'white', marginBottom: 10 }}
          >
            ➕ ADD CLASS
          </button>
        </>
      )}

      <button className="add-cancel-button" onClick={toggleFutureDates}>
        {showFuture ? 'Hide Future Classes' : 'See Future Classes'}
      </button>
      <RefreshStatus
        message={pastClassesCheckedAt
          ? `Last updated: ${new Date(pastClassesCheckedAt).toLocaleString()}`
          : 'Not updated yet'}
        error={pastClassesError}
        loading={pastClassesLoading}
        onRefresh={handleRefreshPastClasses}
        refreshLabel="Refresh classes"
      />

      {warnings.length > 0 && (user?.role === 'admin' || user?.role === 'coach') && (
        <section className="class-warnings" aria-label="Class warnings">
          <h3>⚠️ ACTION NEEDED</h3>
          <ul>
            {warnings.map(warning => (
              <li
                key={`${warning.type}-${warning.date}`}
                className={`class-warning class-warning--${warning.type}`}
              >
                <button
                  type="button"
                  onClick={() => {
                    if (warning.type === 'missing') {
                      openAddClassForm(warning.date);
                    } else {
                      navigate(`/group/${groupId}/class/${warning.date}`);
                    }
                  }}
                >
                  <span className="class-warning-date">{warning.date}</span>
                  <span className="class-warning-message">
                    <span aria-hidden="true">{warning.type === 'missing' ? '🚫' : '⚠️'}</span>
                    {warning.message}
                  </span>
                  <span aria-hidden="true">➔</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {showFuture && (
        <>
          <h3 className="classes-heading">FUTURE CLASSES</h3>
          <div className="classes-header">
            <span>CLASSES DATE</span>
            <span>IS COMPLETED</span>
            <span>SEE MORE</span>
          </div>
          <ul className="class-list">
            {futureDates.map(date => (
              <li key={date} className="class-item">
                <span>{date}</span>
                <span className="check">🕒</span>
                <span
                  className="arrow"
                  onClick={(e) => {
                    e.stopPropagation();
                    navigate(`/group/${groupId}/class/${date}`);
                  }}
                >➔</span>
              </li>
            ))}
          </ul>
        </>
      )}

      <h3 className="classes-heading">CLASSES</h3>
      <div className="classes-header">
        <span>CLASSES DATE</span>
        <span>IS COMPLETED</span>
        <span>SEE MORE</span>
      </div>

      <ul className="class-list">
        {pastClassesLoaded && pastDates.length === 0 && (
          <li className="class-item">No recorded classes.</li>
        )}
        {pastDates.map(past => (
          <li key={past.date} className="class-item">
            <span>{past.date}</span>
            <span
              className="check"
              onClick={() => {
                if (!canManageClasses || isToggling) return;
                setSelectedDate(past.date);
                setShowModal(true);
              }}
              title={canManageClasses
                ? isToggling ? 'Working…' : (past.canceled ? 'Uncancel' : 'Cancel')
                : 'Class status'}
              style={{
                opacity: isToggling ? 0.6 : 1,
                pointerEvents: canManageClasses && !isToggling ? 'auto' : 'none',
              }}
            >
              {past.canceled ? '❌' : isAttendanceComplete(past) ? '✅' : '⚠️'}
            </span>
            <span
              className="arrow"
              onClick={(e) => {
                e.stopPropagation();
                navigate(`/group/${groupId}/class/${past.date}`);
              }}
            >
              ➔
            </span>
          </li>
        ))}
      </ul>
      <br></br><br></br>
      {user?.role === 'admin' && (
        <button
          className="delete-group-button"
          onClick={handleDeleteGroup}
          disabled={isDeletingGroup}
          title={isDeletingGroup ? 'Deleting group…' : 'Delete group'}
        >
          {isDeletingGroup ? 'Deleting group…' : 'DELETE GROUP'}
        </button>
      )}

      {showModal && (
        <div className="modal-overlay">
          <div className="modal-box">
            <p>
              {pastDates.find(p => p.date === selectedDate)?.canceled
                ? 'Uncancel this class?'
                : 'Cancel this class?'}
            </p>
            <div className="modal-buttons">
              <button onClick={() => setShowModal(false)} disabled={isToggling}>No</button>
              <button onClick={handleToggleCancel} disabled={isToggling}>
                {isToggling ? 'Working…' : 'Yes'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showAddForm && (
        <div className="modal-overlay">
          <div className="modal-box add-class-modal" role="dialog" aria-modal="true" aria-labelledby="add-class-title">
            <h3 id="add-class-title"><span aria-hidden="true">＋</span> ADD NEW CLASS</h3>

            <div className="add-class-form">
              <label className="add-class-field">
                <span>Date</span>
                <input
                  type="date"
                  value={newDate}
                  onChange={(e) => setNewDate(e.target.value)}
                  disabled={isAdding}
                />
              </label>

              <label className="add-class-field add-class-field--optional">
                <span>Different time <small>Optional</small></span>
                <input
                  type="time"
                  value={newTime}
                  onChange={(e) => setNewTime(e.target.value)}
                  disabled={isAdding}
                />
              </label>

              <label className="add-class-field">
                <span>Rent (€)</span>
                <input
                  type="number"
                  min="0"
                  placeholder="0"
                  value={newRent}
                  onChange={(e) => setNewRent(e.target.value)}
                  disabled={isAdding}
                />
              </label>

              <label className="add-class-field">
                <span>Coach</span>
                <select
                  value={newCoach}
                  onChange={(e) => setNewCoach(e.target.value)}
                  disabled={isAdding}
                >
                  <option value="">Select coach</option>
                  {coaches?.map((coach) => (
                    <option key={coach.id} value={coach.id}>
                      {coach.name}
                    </option>
                  ))}
                </select>
              </label>

              <label className="add-class-checkbox">
                <input
                  type="checkbox"
                  checked={newCanceled}
                  onChange={(e) => setNewCanceled(e.target.checked)}
                  disabled={isAdding}
                />
                <span>Canceled</span>
              </label>
            </div>

            <div className="modal-buttons add-class-actions">
              <button type="button" onClick={() => setShowAddForm(false)} disabled={isAdding}>Cancel</button>
              <button type="button" onClick={handleAddClass} disabled={isAdding}>
                {isAdding ? 'Adding…' : 'Add class'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default GroupClassesPage;
