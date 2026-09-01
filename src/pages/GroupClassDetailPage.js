import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  doc,
  getDocFromServer,
  setDoc,
  deleteDoc,
  deleteField,
  runTransaction,
  serverTimestamp,
  writeBatch,
} from 'firebase/firestore';
import { useData } from '../context/firebase';
import { useUser } from '../context/UserContext';
import { getClassSignedStudentsByPayments } from '../utils/paymentsUtils';
import { getCoachPayForClass } from '../utils/coachSalaryUtils';
import { invalidateSalarySummaries } from '../utils/salaryCache';
import {
  invalidateReadCache,
  markReadCacheChanged,
} from '../utils/readCacheEpoch';
import RefreshStatus from '../components/RefreshStatus';
import './GroupClassDetailPage.css';

const ATTENDANCE_TRACKING_START = new Date(2026, 5, 1);

function isBeforeAttendanceTracking(dateStr) {
  const [dd, mm, yyyy] = String(dateStr || '').split('.').map(Number);
  return new Date(yyyy, mm - 1, dd) < ATTENDANCE_TRACKING_START;
}

function isFutureDate(dateStr) {
  const [dd, mm, yyyy] = String(dateStr || '').split('.').map(Number);
  const classDate = new Date(yyyy, mm - 1, dd);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return classDate >= today;
}

function GroupClassDetailPage() {
  const { groupId, date } = useParams();
  const navigate = useNavigate();
  const {
    db,
    groups,
    payments,
    students,
    coaches,
    pastClassesByGroup,
    loadPastClassDocs,
    updateCachedClass,
    invalidatePastClasses,
    patchStudent,
    studentsLoaded,
    paymentsLoaded,
    studentsLoading,
    paymentsLoading,
    studentsError,
    paymentsError,
    refreshStudents,
    refreshPayments,
    scheduleCache,
    replacementCache,
    coachTasksCache,
  } = useData();
  const { user } = useUser();
  const routeKey = `${groupId}:${date}`;
  const classRef = React.useMemo(
    () => doc(db, `groups/${groupId}/pastClasses`, date),
    [db, groupId, date]
  );
  const replacementRef = React.useMemo(
    () => doc(db, `groups/${groupId}/replacementSuggestions`, date),
    [db, groupId, date]
  );

  const group = React.useMemo(
    () => groups.find(candidate => candidate.id === groupId) || null,
    [groupId, groups]
  );
  const [signedUp, setSignedUp] = useState(undefined);
  const [absences, setAbsences] = useState({});
  const [loadingId, setLoadingId] = useState(null);
  const [loadingAbsences, setLoadingAbsences] = useState(true);
  const [isCanceled, setIsCanceled] = useState(false);
  const [classExists, setClassExists] = useState(false);
  const [coachesThisClass, setCoaches] = useState(undefined);
  const [rent, setRent] = useState(null);
  const [comment, setComment] = useState('');
  const [savedComment, setSavedComment] = useState('');
  const [savingComment, setSavingComment] = useState(false);
  const [attendanceCompleted, setAttendanceCompleted] = useState(false);
  const [unpaidAttendeeIds, setUnpaidAttendeeIds] = useState([]);
  const [savingUnpaidAttendeeId, setSavingUnpaidAttendeeId] = useState('');
  const [savingAttendanceStatus, setSavingAttendanceStatus] = useState(false);
  const [replacement, setReplacement] = useState(null);
  const [replacementCoachId, setReplacementCoachId] = useState('');
  const [savingReplacement, setSavingReplacement] = useState(false);
  const [savingClassCoach, setSavingClassCoach] = useState(false);
  const [refreshingData, setRefreshingData] = useState(false);
  const [classStatusLoading, setClassStatusLoading] = useState(true);
  const [classStatusError, setClassStatusError] = useState('');
  const [replacementError, setReplacementError] = useState('');
  const [signedUpError, setSignedUpError] = useState('');
  const [signedUpDataKey, setSignedUpDataKey] = useState('');
  const [classDataKey, setClassDataKey] = useState('');
  const [replacementDataKey, setReplacementDataKey] = useState('');
  const [deletingClass, setDeletingClass] = useState(false);
  const classReadRequest = useRef(null);
  const replacementReadRequest = useRef(null);
  const classLoadGeneration = useRef(0);
  const replacementLoadGeneration = useRef(0);
  const attendanceMutationInProgress = useRef(false);
  const classDeletionInProgress = useRef(false);

  const applyClassStatus = useCallback(({ exists, data }) => {
      setClassExists(exists);
      setIsCanceled(data?.canceled === true);
      setCoaches(data?.coach || []);
      setRent(data?.rent ?? 0);
      const hasAttendanceStatus = typeof data?.attendanceCompleted === 'boolean';
      setAttendanceCompleted(
        data?.attendanceCompleted === true ||
        (!hasAttendanceStatus && data?.canceled !== true && isBeforeAttendanceTracking(date))
      );
      setUnpaidAttendeeIds(Array.isArray(data?.unpaidAttendees) ? data.unpaidAttendees : []);
      const nextComment = typeof data?.comment === 'string' ? data.comment : '';
      setComment(nextComment);
      setSavedComment(nextComment);
  }, [date]);

  const readClassStatus = useCallback(async ({ force = false } = {}) => {
    const cached = pastClassesByGroup.get(groupId);
    if (!force && cached) {
      // Enter through the provider so its TTL is enforced. This only downloads
      // the full history when an already-populated history cache has expired;
      // a cold exact-detail route still uses the point read below.
      const freshCachedDocs = await loadPastClassDocs(groupId);
      const cachedItem = freshCachedDocs.find(item => item.id === date);
      return {
        exists: Boolean(cachedItem),
        data: cachedItem?.data() || {},
      };
    }

    const key = `${groupId}:${date}`;
    let requestEntry = classReadRequest.current;
    if (!requestEntry || requestEntry.key !== key) {
      const promise = getDocFromServer(classRef)
        .then(snapshot => ({
          exists: snapshot.exists(),
          data: snapshot.exists() ? snapshot.data() : {},
        }))
        .finally(() => {
          if (classReadRequest.current?.promise === promise) {
            classReadRequest.current = null;
          }
        });
      requestEntry = { key, promise };
      classReadRequest.current = requestEntry;
    }

    return requestEntry.promise;
  }, [classRef, date, groupId, loadPastClassDocs, pastClassesByGroup]);

  const loadClassStatus = useCallback(async ({ force = false } = {}) => {
    const generation = classLoadGeneration.current + 1;
    classLoadGeneration.current = generation;
    setClassStatusLoading(true);
    setClassStatusError('');
    try {
      const result = await readClassStatus({ force });
      if (classLoadGeneration.current !== generation) return;
      if (force && pastClassesByGroup.has(groupId)) {
        updateCachedClass(
          groupId,
          date,
          result.data,
          result.exists ? undefined : { remove: true }
        );
      }
      applyClassStatus(result);
      setClassDataKey(routeKey);
    } catch (error) {
      console.error('Failed to load class status:', error);
      if (classLoadGeneration.current !== generation) return;
      setClassStatusError('Class details could not be loaded. Please try again.');
      throw error;
    } finally {
      if (classLoadGeneration.current === generation) {
        setClassStatusLoading(false);
      }
    }
  }, [applyClassStatus, date, groupId, pastClassesByGroup, readClassStatus, routeKey, updateCachedClass]);

  useEffect(() => {
    loadClassStatus().catch(() => {});
    return () => {
      classLoadGeneration.current += 1;
    };
  }, [loadClassStatus]);

  const readReplacement = useCallback(async ({ force = false } = {}) => {
    if (!isFutureDate(date)) return null;
    const cacheKey = `${groupId}:${date}`;
    if (!force && replacementCache.has(cacheKey)) {
      return replacementCache.get(cacheKey);
    }

    let requestEntry = replacementReadRequest.current;
    if (!requestEntry || requestEntry.key !== cacheKey) {
      const promise = getDocFromServer(replacementRef)
        .then(snapshot => snapshot.exists() ? snapshot.data() : null)
        .finally(() => {
          if (replacementReadRequest.current?.promise === promise) {
            replacementReadRequest.current = null;
          }
        });
      requestEntry = { key: cacheKey, promise };
      replacementReadRequest.current = requestEntry;
    }
    return requestEntry.promise;
  }, [date, groupId, replacementCache, replacementRef]);

  const loadReplacement = useCallback(async ({ force = false } = {}) => {
    if (!isFutureDate(date)) {
      setReplacement(null);
      setReplacementCoachId('');
      setReplacementError('');
      setReplacementDataKey(routeKey);
      return;
    }

    const generation = replacementLoadGeneration.current + 1;
    replacementLoadGeneration.current = generation;
    setReplacementError('');
    const cameFromServer = force || !replacementCache.has(`${groupId}:${date}`);
    try {
      const data = await readReplacement({ force });
      if (replacementLoadGeneration.current !== generation) return;
      if (cameFromServer) markReadCacheChanged(replacementCache);
      replacementCache.set(`${groupId}:${date}`, data);
      setReplacement(data);
      setReplacementCoachId(data?.suggestedCoach || '');
      setReplacementDataKey(routeKey);
    } catch (error) {
      console.error('Failed to load replacement suggestion:', error);
      if (replacementLoadGeneration.current !== generation) return;
      setReplacementError('Replacement details could not be loaded.');
      throw error;
    }
  }, [date, groupId, readReplacement, replacementCache, routeKey]);

  useEffect(() => {
    loadReplacement().catch(() => {});
    return () => {
      replacementLoadGeneration.current += 1;
    };
  }, [loadReplacement]);

  useEffect(() => {
    const result = {};
    for (const s of students) {
      result[s.id] = s.absences || {};
    }
    setAbsences(result);
    setLoadingAbsences(false);
  }, [students]);

  function computeEarnings({ matched, user, coachesThisClass, rent, group, date }) {
    // total earned from payments
    const total = matched.reduce(
      (sum, s) => sum + Number.parseFloat(s?.amount ?? 0),
      0
    );

    // defaults
    let forCoachesLoc = 0;
    let earnedLoc = 0;
    const coachPay = getCoachPayForClass(group, date, matched.length);

    // ADMIN logic
    if (user?.role === "admin") {
      const includesCoach = coachesThisClass?.includes?.(user.id);
      const coachCount = coachesThisClass?.length ?? 0;

      if (includesCoach) {
        forCoachesLoc = (coachCount - 1) * coachPay;
      } else {
        forCoachesLoc = coachCount * coachPay;
      }

      // use purely local totals, not state
      earnedLoc = total - Number(rent ?? 0) - forCoachesLoc;
    }

    // COACH logic
    if (user?.role === "coach") {
      const isInThisClass = coachesThisClass?.includes?.(user.id);
      const isGroupCoachAndNoCoachesListed =
        (coachesThisClass?.length ?? 0) === 0 && user?.id === group?.coach;

      if (isInThisClass || isGroupCoachAndNoCoachesListed) {
        earnedLoc = coachPay;
      } else {
        earnedLoc = 0;
      }
    }

    return {
      total,
      forCoachesLoc,
      earnedLoc,
    };
  }

  useEffect(() => {
    if (classDataKey !== routeKey || !group || coachesThisClass === undefined) {
      setSignedUp(undefined);
      setSignedUpDataKey('');
      return;
    }

    if (!studentsLoaded || !paymentsLoaded) {
      setSignedUp(undefined);
      setSignedUpDataKey('');
      setSignedUpError('');
      return;
    }

    if (!students?.length) {
      setSignedUp([]);
      setSignedUpDataKey(routeKey);
      setSignedUpError('');
      return;
    }

    let active = true;
    setSignedUpDataKey('');
    setSignedUpError('');
    (async () => {
      try {
        // Paid students come from payment coverage. Signed students without a
        // payment are included only after the coach/admin explicitly records
        // them as an unpaid attendee on this class.
        const paymentMatches = payments?.length
          ? await getClassSignedStudentsByPayments({
              groupId,
              date,
              students,
              payments,
              groups,
              user,
              pastClassesByGroup,
              loadPastClassDocs,
            })
          : [];
        const paymentByStudentId = new Map(
          paymentMatches.map(student => [student.id, student])
        );
        const enrolledIds = new Set([
          ...paymentMatches.map(student => student.id),
          ...unpaidAttendeeIds,
        ]);
        const matched = students
          .filter(student => enrolledIds.has(student.id))
          .map(student => ({
            ...student,
            amount: Number(paymentByStudentId.get(student.id)?.amount || 0),
            hasPaymentForClass: paymentByStudentId.has(student.id),
          }))
          .sort((first, second) => String(first.name || '').localeCompare(String(second.name || '')));

        if (!active) return;
        setSignedUp(matched);
        setSignedUpDataKey(routeKey);

        if (matched.length === 0) {
          return;
        }

        const { total, forCoachesLoc, earnedLoc } = computeEarnings({
          matched,
          user,
          coachesThisClass,
          rent,
          group,
          date,
        });

        console.log('Computed earnings:', { total, forCoachesLoc, earnedLoc });
      } catch (err) {
        console.error('Failed to calculate class signups:', err);
        if (active) {
          setSignedUp(undefined);
          setSignedUpError('People for this class could not be calculated. Please refresh.');
        }
      }
    })();

    return () => {
      active = false;
    };
  }, [classDataKey, routeKey, group, groupId, date, payments, students, studentsLoaded, paymentsLoaded, user, groups, rent, coachesThisClass, unpaidAttendeeIds, pastClassesByGroup, loadPastClassDocs]);

  const handleRefreshData = async () => {
    if (refreshingData || studentsLoading || paymentsLoading) return;

    // Payment coverage depends on complete histories for every group involved.
    // A manual refresh deliberately invalidates those shared histories so the
    // next calculation reloads them through the coalesced provider loader.
    invalidatePastClasses();
    setRefreshingData(true);
    try {
      const results = await Promise.allSettled([
        refreshStudents(),
        refreshPayments(),
        loadClassStatus({ force: true }),
        loadReplacement({ force: true }),
      ]);
      const rejected = results.find(result => result.status === 'rejected');
      if (rejected) {
        console.error('Some class data could not be refreshed:', rejected.reason);
      }
    } finally {
      setRefreshingData(false);
    }
  };

  const earnings = React.useMemo(() => {
    if (
      signedUpDataKey !== routeKey ||
      !signedUp ||
      !Array.isArray(signedUp) ||
      signedUp.length === 0
    ) {
      return { total: 0, forCoachesLoc: 0, earnedLoc: 0 };
    }
    return computeEarnings({
      matched: signedUp,
      user,
      coachesThisClass,
      rent,
      group,
      date,
    });
  }, [signedUp, signedUpDataKey, routeKey, user, coachesThisClass, rent, group, date]);

  const classStateReady = classDataKey === routeKey;
  const replacementStateReady = replacementDataKey === routeKey;
  const classMutationBlocked =
    !classStateReady ||
    classStatusLoading ||
    Boolean(classStatusError) ||
    refreshingData;
  const replacementMutationBlocked =
    classMutationBlocked ||
    !replacementStateReady ||
    Boolean(replacementError);
  const signedUpStateReady = signedUpDataKey === routeKey;

  const toggleAttendance = async (studentId) => {
    if (classMutationBlocked || attendanceMutationInProgress.current || loadingId) return;
    const student = students.find(s => s.id === studentId);
    if (!window.confirm(`Toggle attendance for ${student?.name} on ${date}?`)) return;

    attendanceMutationInProgress.current = true;
    setLoadingId(studentId);
    const ref = doc(db, 'students', studentId);
    try {
      const nextStudentAbsences = await runTransaction(db, async transaction => {
        const snapshot = await transaction.get(ref);
        if (!snapshot.exists()) {
          throw new Error('Student document does not exist.');
        }

        const latestAbsences = { ...(snapshot.data()?.absences || {}) };
        const currentGroups = Array.isArray(latestAbsences[date])
          ? latestAbsences[date]
          : [];
        const nextGroups = currentGroups.includes(groupId)
          ? currentGroups.filter(id => id !== groupId)
          : [...currentGroups, groupId];

        if (nextGroups.length === 0) {
          delete latestAbsences[date];
          transaction.set(
            ref,
            { absences: { [date]: deleteField() } },
            { merge: true }
          );
        } else {
          latestAbsences[date] = nextGroups;
          transaction.set(
            ref,
            { absences: { [date]: nextGroups } },
            { merge: true }
          );
        }

        return latestAbsences;
      });

      setAbsences(currentAbsences => {
        const nextAbsences = { ...currentAbsences };
        if (Object.keys(nextStudentAbsences).length === 0) {
          delete nextAbsences[studentId];
        } else {
          nextAbsences[studentId] = nextStudentAbsences;
        }
        return nextAbsences;
      });
      patchStudent(studentId, { absences: nextStudentAbsences });
    } catch (err) {
      console.error('Failed to toggle attendance:', err);
      alert('❌ Failed to update attendance');
    } finally {
      attendanceMutationInProgress.current = false;
      setLoadingId(null);
    }
  };

  const handleSaveComment = async () => {
    if (classMutationBlocked || !classExists || savingComment || comment === savedComment) return;

    setSavingComment(true);
    try {
      const nextComment = comment.trim();

      if (nextComment) {
        await setDoc(classRef, { comment: nextComment }, { merge: true });
      } else {
        await setDoc(classRef, { comment: deleteField() }, { merge: true });
      }

      setComment(nextComment);
      setSavedComment(nextComment);
      updateCachedClass(groupId, date, { comment: nextComment });
      invalidateSalarySummaries();
    } catch (err) {
      console.error('Failed to save comment:', err);
      alert('❌ Failed to save comment');
    } finally {
      setSavingComment(false);
    }
  };

  const handleToggleAttendanceCompleted = async () => {
    if (
      classMutationBlocked ||
      !classExists ||
      savingAttendanceStatus ||
      savingComment
    ) return;

    const nextCompleted = !attendanceCompleted;
    const nextComment = comment.trim();
    const commentChanged = comment !== savedComment;
    setSavingAttendanceStatus(true);
    try {
      const update = {
        attendanceCompleted: nextCompleted,
        attendanceCompletedAt: nextCompleted ? serverTimestamp() : deleteField(),
      };

      // Save an edited comment in the same write as the attendance status.
      if (commentChanged) {
        update.comment = nextComment || deleteField();
      }

      await setDoc(classRef, update, { merge: true });
      setAttendanceCompleted(nextCompleted);
      updateCachedClass(groupId, date, {
        attendanceCompleted: nextCompleted,
        ...(commentChanged ? { comment: nextComment } : {}),
      });
      invalidateReadCache(coachTasksCache);
      if (commentChanged) invalidateSalarySummaries();
      if (commentChanged) {
        setComment(nextComment);
        setSavedComment(nextComment);
      }
    } catch (err) {
      console.error('Failed to update attendance status:', err);
      alert('❌ Failed to update attendance status');
    } finally {
      setSavingAttendanceStatus(false);
    }
  };

  const handleDeleteClass = async () => {
    if (
      classMutationBlocked ||
      !classExists ||
      deletingClass ||
      classDeletionInProgress.current
    ) return;
    if (!window.confirm(`Delete class ${date} from group ${group?.name}?`)) return;
    classDeletionInProgress.current = true;
    setDeletingClass(true);
    try {
      await deleteDoc(doc(db, `groups/${groupId}/pastClasses`, date));
      updateCachedClass(groupId, date, {}, { remove: true });
      invalidateReadCache(scheduleCache);
      invalidateReadCache(coachTasksCache);
      invalidateSalarySummaries();
      alert('✅ Class deleted');
      navigate(`/group/${groupId}`);
    } catch (err) {
      console.error(err);
      alert('❌ Failed to delete class');
    } finally {
      classDeletionInProgress.current = false;
      setDeletingClass(false);
    }
  };

  const handleSuggestReplacement = async (coachId = replacementCoachId) => {
    if (
      replacementMutationBlocked ||
      !coachId ||
      savingReplacement
    ) return;
    const autoConfirmed = coachId === user?.id;
    const nextReplacement = {
      originalCoach: group?.coach || '',
      suggestedCoach: coachId,
      suggestedBy: user.id,
      status: autoConfirmed ? 'confirmed' : 'pending',
      suggestedAt: serverTimestamp(),
      confirmedAt: autoConfirmed ? serverTimestamp() : null,
    };

    setSavingReplacement(true);
    try {
      const batch = writeBatch(db);
      batch.set(replacementRef, nextReplacement);
      if (autoConfirmed && classExists) {
        batch.set(classRef, { coach: [coachId] }, { merge: true });
      }
      await batch.commit();
      setReplacement({ ...nextReplacement, suggestedAt: new Date(), confirmedAt: autoConfirmed ? new Date() : null });
      markReadCacheChanged(replacementCache);
      replacementCache.set(`${groupId}:${date}`, nextReplacement);
      setReplacementCoachId(coachId);
      if (autoConfirmed && classExists) setCoaches([coachId]);
      if (autoConfirmed && classExists) updateCachedClass(groupId, date, { coach: [coachId] });
      invalidateReadCache(scheduleCache);
      invalidateReadCache(coachTasksCache);
      if (autoConfirmed && classExists) invalidateSalarySummaries();
    } catch (error) {
      console.error('Failed to suggest replacement:', error);
      alert('❌ Failed to save replacement suggestion');
    } finally {
      setSavingReplacement(false);
    }
  };

  const handlePastClassCoachChange = async (coachId) => {
    if (
      isFutureDate(date) ||
      !classExists ||
      !coachId ||
      savingClassCoach ||
      (user?.role !== 'admin' && coachId !== user?.id)
    ) return;

    setSavingClassCoach(true);
    try {
      const batch = writeBatch(db);
      batch.set(classRef, { coach: [coachId] }, { merge: true });
      batch.delete(replacementRef);
      await batch.commit();

      setCoaches([coachId]);
      setReplacement(null);
      setReplacementCoachId('');
      updateCachedClass(groupId, date, { coach: [coachId] });
      markReadCacheChanged(replacementCache);
      replacementCache.set(`${groupId}:${date}`, null);
      invalidateReadCache(scheduleCache);
      invalidateReadCache(coachTasksCache);
      invalidateSalarySummaries();
    } catch (error) {
      console.error('Failed to update the class coach:', error);
      alert('❌ Failed to update the class coach');
    } finally {
      setSavingClassCoach(false);
    }
  };

  const handleToggleUnpaidAttendee = async (studentId) => {
    if (
      !classExists ||
      !canEditComment ||
      classMutationBlocked ||
      savingUnpaidAttendeeId
    ) return;

    const isSelected = unpaidAttendeeIds.includes(studentId);
    const nextIds = isSelected
      ? unpaidAttendeeIds.filter(id => id !== studentId)
      : [...unpaidAttendeeIds, studentId];

    setSavingUnpaidAttendeeId(studentId);
    try {
      await setDoc(classRef, { unpaidAttendees: nextIds }, { merge: true });
      setUnpaidAttendeeIds(nextIds);
      updateCachedClass(groupId, date, { unpaidAttendees: nextIds });
      invalidateSalarySummaries();
    } catch (error) {
      console.error('Failed to update unpaid attendance:', error);
      alert('❌ Failed to update unpaid attendance');
    } finally {
      setSavingUnpaidAttendeeId('');
    }
  };

  const handleRemoveUnpaidAttendee = (student) => {
    if (!window.confirm(`Remove ${student.name} from the unpaid students list?`)) return;
    handleToggleUnpaidAttendee(student.id);
  };

  const handleConfirmReplacement = async () => {
    if (
      replacementMutationBlocked ||
      !replacement ||
      replacement.suggestedCoach !== user?.id ||
      savingReplacement
    ) return;
    setSavingReplacement(true);
    try {
      const batch = writeBatch(db);
      batch.set(replacementRef, {
          status: 'confirmed',
          confirmedBy: user.id,
          confirmedAt: serverTimestamp(),
        }, { merge: true });
      if (classExists) {
        batch.set(classRef, { coach: [user.id] }, { merge: true });
      }
      await batch.commit();
      setReplacement(current => ({ ...current, status: 'confirmed', confirmedBy: user.id }));
      markReadCacheChanged(replacementCache);
      replacementCache.set(`${groupId}:${date}`, {
        ...replacement,
        status: 'confirmed',
        confirmedBy: user.id,
      });
      if (classExists) setCoaches([user.id]);
      if (classExists) updateCachedClass(groupId, date, { coach: [user.id] });
      invalidateReadCache(scheduleCache);
      invalidateReadCache(coachTasksCache);
      if (classExists) invalidateSalarySummaries();
    } catch (error) {
      console.error('Failed to confirm replacement:', error);
      alert('❌ Failed to confirm replacement');
    } finally {
      setSavingReplacement(false);
    }
  };

  const handleCancelReplacement = async () => {
    if (
      replacementMutationBlocked ||
      !replacement ||
      savingReplacement
    ) return;
    if (!window.confirm('Cancel this replacement suggestion?')) return;

    setSavingReplacement(true);
    try {
      const originalCoach = replacement.originalCoach || group?.coach;
      const batch = writeBatch(db);
      batch.delete(replacementRef);
      if (classExists && replacement.status === 'confirmed' && originalCoach) {
        batch.set(classRef, { coach: [originalCoach] }, { merge: true });
      }
      await batch.commit();
      setReplacement(null);
      markReadCacheChanged(replacementCache);
      replacementCache.set(`${groupId}:${date}`, null);
      setReplacementCoachId('');
      if (classExists && replacement.status === 'confirmed' && originalCoach) {
        setCoaches([originalCoach]);
        updateCachedClass(groupId, date, { coach: [originalCoach] });
      }
      invalidateReadCache(scheduleCache);
      invalidateReadCache(coachTasksCache);
      if (classExists && replacement.status === 'confirmed' && originalCoach) {
        invalidateSalarySummaries();
      }
    } catch (error) {
      console.error('Failed to cancel replacement:', error);
      alert('❌ Failed to cancel replacement');
    } finally {
      setSavingReplacement(false);
    }
  };

  const handleDenyReplacement = async () => {
    if (
      replacementMutationBlocked ||
      !replacement ||
      replacement.suggestedCoach !== user?.id ||
      savingReplacement
    ) return;
    if (!window.confirm('Deny this replacement request?')) return;

    setSavingReplacement(true);
    try {
      const originalCoach = replacement.originalCoach || group?.coach;
      const batch = writeBatch(db);
      batch.set(replacementRef, {
        status: 'denied',
        deniedBy: user.id,
        deniedAt: serverTimestamp(),
        confirmedBy: deleteField(),
        confirmedAt: deleteField(),
      }, { merge: true });
      if (classExists && originalCoach) {
        batch.set(classRef, { coach: [originalCoach] }, { merge: true });
      }
      await batch.commit();
      setReplacement(current => ({
        ...current,
        status: 'denied',
        deniedBy: user.id,
        confirmedBy: undefined,
        confirmedAt: undefined,
      }));
      markReadCacheChanged(replacementCache);
      replacementCache.set(`${groupId}:${date}`, {
        ...replacement,
        status: 'denied',
        deniedBy: user.id,
        confirmedBy: undefined,
        confirmedAt: undefined,
      });
      if (classExists && originalCoach) setCoaches([originalCoach]);
      if (classExists && originalCoach) updateCachedClass(groupId, date, { coach: [originalCoach] });
      invalidateReadCache(scheduleCache);
      invalidateReadCache(coachTasksCache);
      if (classExists && originalCoach) invalidateSalarySummaries();
    } catch (error) {
      console.error('Failed to deny replacement:', error);
      alert('❌ Failed to deny replacement');
    } finally {
      setSavingReplacement(false);
    }
  };

  const handleAcknowledgeDenial = async () => {
    if (
      replacementMutationBlocked ||
      !replacement ||
      replacement.status !== 'denied' ||
      !isGroupCoach ||
      savingReplacement
    ) return;
    setSavingReplacement(true);
    try {
      await deleteDoc(replacementRef);
      setReplacement(null);
      markReadCacheChanged(replacementCache);
      replacementCache.set(`${groupId}:${date}`, null);
      setReplacementCoachId('');
      invalidateReadCache(scheduleCache);
      invalidateReadCache(coachTasksCache);
    } catch (error) {
      console.error('Failed to acknowledge denial:', error);
      alert('❌ Failed to acknowledge denial');
    } finally {
      setSavingReplacement(false);
    }
  };

  const coachNameById = React.useMemo(
    () => new Map((coaches || []).map(c => [c.id, c.name])),
    [coaches]
  );
  const canEditComment = user?.role === 'admin' || user?.role === 'coach';
  // Respect the active view: an admin using Coach view has coach permissions.
  const isAdminAccount = user?.role === 'admin';
  const isGroupCoach = group?.coach === user?.id;
  const canSuggestReplacement = user?.role === 'coach' || isAdminAccount;
  const canNominateOtherCoach = isAdminAccount || isGroupCoach;
  const replacementOptions = canNominateOtherCoach
    ? (coaches || [])
    : (coaches || []).filter(coach => coach.id === user?.id);
  const canCancelReplacement = replacement &&
    replacement.suggestedBy === user?.id &&
    replacement.suggestedCoach !== user?.id;
  const proposedCoachName = replacement
    ? (coachNameById.get(replacement.suggestedCoach) || replacement.suggestedCoach)
    : '';
  const currentClassCoachId = coachesThisClass?.[0] || '';
  const pastClassCoachOptions = isAdminAccount
    ? (coaches || [])
    : (coaches || []).filter(coach => coach.id === user?.id || coach.id === currentClassCoachId);
  const paidStudents = Array.isArray(signedUp)
    ? signedUp.filter(student => student.hasPaymentForClass)
    : [];
  const paidStudentIds = new Set(paidStudents.map(student => student.id));
  const unpaidAttendeeStudents = students
    .filter(student => unpaidAttendeeIds.includes(student.id))
    .filter(student => !paidStudentIds.has(student.id))
    .sort((first, second) => String(first.name || '').localeCompare(String(second.name || '')));
  const availableSignedStudents = students
    .filter(student => Array.isArray(group?.signedStudents) && group.signedStudents.includes(student.id))
    .filter(student => !paidStudentIds.has(student.id) && !unpaidAttendeeIds.includes(student.id))
    .sort((first, second) => String(first.name || '').localeCompare(String(second.name || '')));

  if (!classStateReady) {
    return (
      <div className="class-detail-page">
        <header className="class-detail-header">
          <div>
            <h2>{group?.name?.toUpperCase()}</h2>
            <p>{date}</p>
          </div>
          <button type="button" onClick={() => navigate(`/group/${groupId}/details`)}>SIGNED STUDENTS</button>
        </header>
        <RefreshStatus
          message="Class details have not been loaded yet"
          error={classStatusError}
          loading={refreshingData || classStatusLoading}
          onRefresh={handleRefreshData}
          refreshLabel={classStatusError ? 'Retry class data' : 'Refresh data'}
          loadingLabel={classStatusError ? 'Retrying…' : 'Refreshing…'}
        />
      </div>
    );
  }

  return (
    <div className="class-detail-page">
      <header className="class-detail-header">
        <div>
          <h2>{group?.name?.toUpperCase()}</h2>
          <p>{date}</p>
        </div>
        <button type="button" onClick={() => navigate(`/group/${groupId}/details`)}>SIGNED STUDENTS</button>
      </header>
      <RefreshStatus
        message={classStatusLoading ? 'Checking class data…' : 'Class data is loaded'}
        error={studentsError || paymentsError || classStatusError || (isFutureDate(date) ? replacementError : '')}
        loading={refreshingData || studentsLoading || paymentsLoading || classStatusLoading}
        onRefresh={handleRefreshData}
        refreshLabel="Refresh class data"
      />
      {!classStatusLoading && !classStatusError && !classExists && canEditComment && (
        <section className="future-class-callout">
          <div>
            <strong>{isFutureDate(date) ? 'Upcoming class' : '⚠ Class was not added'}</strong>
            <span>{isFutureDate(date)
              ? 'This class has not been added yet.'
              : 'Add the missed class or assign the coach who replaced it.'}</span>
          </div>
          <button
            type="button"
            onClick={() => navigate(`/group/${groupId}`, {
              state: {
                addClassDate: date,
                replacementCoachId: replacementStateReady && replacement?.status === 'confirmed'
                  ? replacement.suggestedCoach
                  : '',
              },
            })}
          >
            + ADD THIS CLASS
          </button>
        </section>
      )}

      {!isFutureDate(date) && classExists && (user?.role === 'admin' || user?.role === 'coach') && (
        <label className="past-class-coach-field">
          <span>Coach</span>
          <select
            value={currentClassCoachId}
            onChange={event => handlePastClassCoachChange(event.target.value)}
            disabled={savingClassCoach || classStatusLoading}
          >
            {!currentClassCoachId && <option value="">No coach assigned</option>}
            {pastClassCoachOptions.map(coach => (
              <option key={coach.id} value={coach.id}>
                {coach.id === user?.id ? `${coach.name || coach.id} (me)` : coach.name || coach.id}
              </option>
            ))}
          </select>
        </label>
      )}

      {isFutureDate(date) && !replacementStateReady && !replacementError && (
        <p role="status">Loading replacement details...</p>
      )}
      {isFutureDate(date) && replacementStateReady && (canSuggestReplacement || replacement) && (
        <section className="replacement-card">
          <h3>Replacement coach</h3>

          {replacement && (
            <div className={`replacement-status replacement-status--${replacement.status}`}>
              <span>{replacement.status === 'confirmed'
                ? '✓ Confirmed'
                : replacement.status === 'denied'
                  ? '✕ Denied'
                  : 'Waiting for confirmation'}</span>
              <strong>{proposedCoachName}</strong>
            </div>
          )}

          {canSuggestReplacement && canNominateOtherCoach && (
            <div className="replacement-suggest-form">
              <label htmlFor="replacement-coach">
                {canNominateOtherCoach ? 'Suggest a coach' : 'Take this class as replacement'}
              </label>
              <select
                id="replacement-coach"
                value={replacementCoachId}
                onChange={event => setReplacementCoachId(event.target.value)}
                disabled={replacementMutationBlocked || savingReplacement}
              >
                <option value="">Select coach</option>
                {replacementOptions.map(coach => (
                  <option key={coach.id} value={coach.id}>
                    {coach.id === user.id ? `${coach.name || coach.id} (me)` : coach.name || coach.id}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => handleSuggestReplacement()}
                disabled={replacementMutationBlocked || !replacementCoachId || savingReplacement}
              >
                {savingReplacement ? 'Saving…' : replacementCoachId === user.id ? 'Confirm me as replacement' : 'Send suggestion'}
              </button>
            </div>
          )}

          {canSuggestReplacement && !canNominateOtherCoach && !replacement && (
            <button
              type="button"
              className="replacement-self-button"
              onClick={() => handleSuggestReplacement(user.id)}
              disabled={replacementMutationBlocked || savingReplacement}
            >
              {savingReplacement ? 'Saving…' : '+ SUGGEST ME'}
            </button>
          )}

          {replacement?.status === 'pending' && replacement.suggestedCoach === user?.id && (
            <button
              type="button"
              className="replacement-confirm-button"
              onClick={handleConfirmReplacement}
              disabled={replacementMutationBlocked || savingReplacement}
            >
              {savingReplacement ? 'Confirming…' : '✓ CONFIRM REPLACEMENT'}
            </button>
          )}

          {replacement && replacement.status !== 'denied' && replacement.suggestedCoach === user?.id && (
            <button
              type="button"
              className="replacement-deny-button"
              onClick={handleDenyReplacement}
              disabled={replacementMutationBlocked || savingReplacement}
            >
              {savingReplacement ? 'Saving…' : '✕ DENY REPLACEMENT'}
            </button>
          )}

          {replacement?.status === 'denied' && isGroupCoach && (
            <button
              type="button"
              className="replacement-acknowledge-button"
              onClick={handleAcknowledgeDenial}
              disabled={replacementMutationBlocked || savingReplacement}
            >
              {savingReplacement ? 'Saving…' : 'I UNDERSTAND — CLOSE REQUEST'}
            </button>
          )}

          {canCancelReplacement && (
            <button
              type="button"
              className="replacement-cancel-button"
              onClick={handleCancelReplacement}
              disabled={replacementMutationBlocked || savingReplacement}
            >
              CANCEL SUGGESTION
            </button>
          )}
        </section>
      )}
      {signedUpError
        ? (<p role="alert" style={{ color: '#9c0000' }}>{signedUpError}</p>)
        : !signedUpStateReady
        ? (<p role="status">Loading people for this class...</p>)
        : signedUp?.length === 0
        ? (isCanceled
            ? (<h3 style={{ color: '#ff76b7' }}>🚫 CLASS CANCELED</h3>)
            : (<h3 style={{ color: '#ff76b7' }}>🚫 NO PEOPLE</h3>)
          ) : (
        <>
        {classExists && !isCanceled && !attendanceCompleted && (
        <p className="attendance-warning">⚠️ Attendance has not been marked complete.</p>
      )}
          <div className="classes-header">
            COACHES:
            {coachesThisClass?.length ? (
              coachesThisClass.map((id) => {
                const emailOrId = coachNameById.get(id) ?? String(id);
                const label = String(emailOrId).split('@')[0].toUpperCase();
                return <span key={id} style={{ marginLeft: 6 }}>{label}</span>;
              })
            ) : (
              <span>—</span>
            )}
          </div>

          {user?.role === "admin" && (
            <div className="classes-header">
              <span>ALL EARNED: {earnings.total.toFixed(2)}€</span>
              <span>FOR RENT {Number(rent ?? 0).toFixed(2)}€</span>
              <span>FOR COACHES: {earnings.forCoachesLoc.toFixed(2)}€</span>
            </div>
          )}
          {((user?.role === "coach" && coachesThisClass?.includes(user.id)) || user?.role === "admin") && <h3>EARNED:</h3>}
          {(!group || !signedUp?.length) ? (
            <img src="/loading.webp" alt="Loading…" width="32" height="32" />
          ) : (
            <>
              {((user?.role === "coach" && coachesThisClass?.includes(user.id)) || user?.role === "admin") &&
                <h1 style={{ fontSize: '36px' }}>{earnings.earnedLoc.toFixed(2)}€</h1>
              }
            </>
          )}
          <h3>PAID STUDENTS</h3>
          <div className="classes-header attendance-list-header">
            <span>PERSON</span>
            {((user?.role === "coach" && coachesThisClass?.includes(user.id)) || user?.role === "admin") && <span>MONEY</span>}
            <span>ATTENDED</span>
          </div>

          <ul className="student-list attendance-student-list">
            {paidStudents.map((s, i) => {
              const isAbsent = !!absences?.[s.id]?.[date]?.includes(groupId);
              const icon = !classExists ? '🕒' : isAbsent ? '❌' : '✅';
              const displayIcon = loadingAbsences ? '🔄' : (loadingId === s.id ? '🔄' : icon);

              return (
                <li key={i} className="class-item attendance-student-row">
                  <span className="attendance-person" onClick={() => navigate(`/student/${s.id}`)}>{i + 1} {s.name?.slice(0, 30)}</span>
                  {((user?.role === "coach" && coachesThisClass?.includes(user.id)) || user?.role === "admin") &&
                    <span className="attendance-payment" onClick={() => navigate(`/student/${s.id}`)}>{s.amount}€</span>
                  }
                  <span
                    className="attendance-mark"
                    style={{ cursor: !classExists || !canEditComment ? 'not-allowed' : 'pointer' }}
                    onClick={() => !classMutationBlocked && classExists && canEditComment && toggleAttendance(s.id)}
                  >
                    {displayIcon}
                  </span>
                </li>
              );
            })}
          </ul>
        </>
      )}
      {classExists && !isCanceled && unpaidAttendeeStudents.length > 0 && (
        <section className="unpaid-students-list-section">
          <h3>UNPAID STUDENTS</h3>
          <div className="classes-header attendance-list-header">
            <span>PERSON</span>
            <span>PAYMENT</span>
            <span>ATTENDED</span>
          </div>
          <ul className="student-list attendance-student-list">
            {unpaidAttendeeStudents.map((student, index) => (
              <li key={student.id} className="class-item attendance-student-row">
                <span className="attendance-person" onClick={() => navigate(`/student/${student.id}`)}>{index + 1} {student.name?.slice(0, 30)}</span>
                <span className="attendance-payment unpaid-payment-label" onClick={() => navigate(`/student/${student.id}`)}>UNPAID</span>
                <button
                  type="button"
                  className="attendance-mark unpaid-attended-button"
                  onClick={() => handleRemoveUnpaidAttendee(student)}
                  disabled={!canEditComment || classMutationBlocked || Boolean(savingUnpaidAttendeeId)}
                  aria-label={`Remove ${student.name} from unpaid students`}
                >
                  {savingUnpaidAttendeeId === student.id ? '…' : '✅'}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      {classExists && !isCanceled && availableSignedStudents.length > 0 && (
        <section className="unpaid-attendees unpaid-attendees--available">
          <div className="unpaid-attendees-heading">
            <div>
              <h3>Signed students</h3>
            </div>
          </div>
          <ul>
            {availableSignedStudents.map(student => (
              <li key={student.id} className="unpaid-attendee-row">
                <button type="button" className="unpaid-attendee-person" onClick={() => navigate(`/student/${student.id}`)}>
                  {student.name}
                </button>
                <button
                  type="button"
                  className="unpaid-add-button"
                  onClick={() => handleToggleUnpaidAttendee(student.id)}
                  disabled={!canEditComment || classMutationBlocked || Boolean(savingUnpaidAttendeeId)}
                >
                  {savingUnpaidAttendeeId === student.id ? 'Adding…' : '+ Add'}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      {classExists && (
        <div className="comment-box">
          <div className="comment-label">COMMENT</div>
          <textarea
            className="comment-textarea"
            value={comment}
            onChange={(e) => canEditComment && setComment(e.target.value)}
            placeholder={canEditComment ? 'Write a comment' : 'No comment'}
            readOnly={!canEditComment}
            rows={4}
          />
          {canEditComment && (
            <div className="comment-actions">
              <button
                className="comment-save-button"
                onClick={handleSaveComment}
                disabled={classMutationBlocked || savingComment || comment === savedComment}
              >
                {savingComment ? 'Saving...' : 'Save Comment'}
              </button>
            </div>
          )}
        </div>
      )}
      {classExists && canEditComment && !isCanceled && (
        <div className="class-status-actions">
          <button
            className={attendanceCompleted ? 'attendance-reopen-button' : 'attendance-complete-button'}
            onClick={handleToggleAttendanceCompleted}
            disabled={classMutationBlocked || savingAttendanceStatus || savingComment}
          >
            {savingAttendanceStatus
              ? 'Saving…'
              : attendanceCompleted
                ? '↩ REOPEN ATTENDANCE'
                : '✓ MARK ATTENDANCE COMPLETE'}
          </button>
        </div>
      )}
      {classExists && canEditComment && (
        <button
          className="delete-class-button"
          onClick={handleDeleteClass}
          disabled={classMutationBlocked || deletingClass}
        >
          {deletingClass ? 'DELETING CLASS…' : '🗑 DELETE CLASS'}
        </button>
      )}
    </div>);
}

export default GroupClassDetailPage;
