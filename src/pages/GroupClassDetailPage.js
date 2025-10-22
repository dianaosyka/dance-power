import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  doc,
  getDoc,
  setDoc,
  deleteDoc,
  deleteField,
} from 'firebase/firestore';
import { useData } from '../context/firebase';
import { useUser } from '../context/UserContext';
import { getClassSignedStudentsByPayments } from '../utils/paymentsUtils';
import './GroupClassDetailPage.css';

function GroupClassDetailPage() {
  const { groupId, date } = useParams();
  const navigate = useNavigate();
  const { db, groups, payments, students, coaches } = useData();
  const { user } = useUser();

  const [group, setGroup] = useState(null);
  const [signedUp, setSignedUp] = useState(undefined);
  const [absences, setAbsences] = useState({});
  const [loadingId, setLoadingId] = useState(null);
  const [loadingAbsences, setLoadingAbsences] = useState(true);
  const [isCanceled, setIsCanceled] = useState(false);
  const [coachesThisClass, setCoaches] = useState(undefined);
  const [rent, setRent] = useState(null);

  useEffect(() => {
    setGroup(groups.find(g => g.id === groupId));
  }, [groupId, groups]);

  useEffect(() => {
    const fetchClassStatus = async () => {
      const ref = doc(db, `groups/${groupId}/pastClasses`, date);
      const snap = await getDoc(ref);
      const data = snap.exists() ? snap.data() : {};
      setIsCanceled(data?.canceled === true);
      setCoaches(data?.coach || []);
      setRent(data?.rent ?? 15);
      console.log('rent for class:', data?.rent ?? 15);
    };
    fetchClassStatus();
  }, [groupId, date, db]);

  useEffect(() => {
    const fetchAbsences = async () => {
      const result = {};
      for (const s of students) {
        const ref = doc(db, 'students', s.id);
        const snap = await getDoc(ref);
        const data = snap.exists() ? snap.data().absences || {} : {};
        result[s.id] = data;
      }
      setAbsences(result);
      setLoadingAbsences(false);
    };
    fetchAbsences();
  }, [students, db]);

  function computeEarnings({ matched, user, coachesThisClass, rent, group }) {
    // total earned from payments
    const total = matched.reduce(
      (sum, s) => sum + Number.parseFloat(s?.amount ?? 0),
      0
    );

    // defaults
    let forCoachesLoc = 0;
    let earnedLoc = 0;

    // ADMIN logic
    if (user?.role === "admin") {
      const includesCoach = coachesThisClass?.includes?.(user.id);
      const coachCount = coachesThisClass?.length ?? 0;

      if (includesCoach) {
        forCoachesLoc = (coachCount - 1) * matched.length;
      } else {
        forCoachesLoc = coachCount * matched.length;
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
        earnedLoc = matched.length * 1;
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
    if (
      !group ||
      !payments?.length ||
      !students?.length ||
      coachesThisClass === undefined
    ) return;

    (async () => {
      // get matched signups
      const matched = await getClassSignedStudentsByPayments({
        groupId,
        date,
        students,
        payments,
        groups,
        db,
        absences,
        user,
      });

      setSignedUp(matched);

      if (matched.length === 0) {
        return;
      }

      const { total, forCoachesLoc, earnedLoc } = computeEarnings({
        matched,
        user,
        coachesThisClass,
        rent,
        group,
      });

      console.log('Computed earnings:', { total, forCoachesLoc, earnedLoc });
    })();
  }, [group, groupId, date, payments, students, absences, user, db, groups, rent, coachesThisClass]);

  const earnings = React.useMemo(() => {
    if (!signedUp || !Array.isArray(signedUp) || signedUp.length === 0) {
      return { total: 0, forCoachesLoc: 0, earnedLoc: 0 };
    }
    return computeEarnings({
      matched: signedUp,
      user,
      coachesThisClass,
      rent,
      group,
    });
  }, [signedUp, user, coachesThisClass, rent, group]);

  const toggleAttendance = async (studentId) => {
    const student = students.find(s => s.id === studentId);
    if (!window.confirm(`Toggle attendance for ${student?.name} on ${date}?`)) return;

    setLoadingId(studentId);
    const ref = doc(db, 'students', studentId);
    const current = absences[studentId]?.[date] || [];
    const isAbsent = current.includes(groupId);

    const newGroups = isAbsent
      ? current.filter(g => g !== groupId)
      : [...current, groupId];

    const newAbsences = { ...absences };
    try {
      if (newGroups.length === 0) {
        if (newAbsences[studentId]) delete newAbsences[studentId][date];
        await setDoc(ref, { absences: { [date]: deleteField() } }, { merge: true });
      } else {
        newAbsences[studentId] = {
          ...newAbsences[studentId],
          [date]: newGroups,
        };
        await setDoc(ref, { absences: { [date]: newGroups } }, { merge: true });
      }
      setAbsences(newAbsences);
    } finally {
      setLoadingId(null);
    }
  };

  const handleDeleteClass = async () => {
    if (!window.confirm(`Delete class ${date} from group ${group?.name}?`)) return;
    try {
      await deleteDoc(doc(db, `groups/${groupId}/pastClasses`, date));
      alert('✅ Class deleted');
      navigate(`/group/${groupId}`);
    } catch (err) {
      console.error(err);
      alert('❌ Failed to delete class');
    }
  };

  const coachEmailById = React.useMemo(
    () => new Map((coaches || []).map(c => [c.id, c.email])),
    [coaches]
  );

  return (
    <div className="class-detail-page">
      <h2>{group?.name?.toUpperCase()}</h2>
      <p>{date}</p>
      {user?.role === 'admin' && (
        <button onClick={handleDeleteClass} style={{ backgroundColor: 'red', color: 'white' }}>
          🗑 DELETE CLASS
        </button>
      )}
      {signedUp?.length === 0
        ? (isCanceled
            ? (<h3 style={{ color: 'red' }}>🚫 CLASS CANCELED</h3>)
            : (<h3 style={{ color: 'red' }}>🚫 NO PEOPLE</h3>)
          ) : (
        <>
          <div className="classes-header">
            COACHES:
            {coachesThisClass?.length ? (
              coachesThisClass.map((id) => {
                const emailOrId = coachEmailById.get(id) ?? String(id);
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
          <h3>PEOPLE</h3>
          <div className="classes-header">
            <span>PERSON</span>
            {((user?.role === "coach" && coachesThisClass?.includes(user.id)) || user?.role === "admin") && <span>MONEY</span>}
            <span>ATTENDED</span>
          </div>

          <ul className="student-list">
            {signedUp?.map((s, i) => {
              const today = new Date();
              const [dd, mm, yyyy] = date.split('.').map(Number);
              const classDate = new Date(yyyy, mm - 1, dd);
              const isFuture = classDate > today;
              const icon = isFuture ? '🕒' : s.absent ? '❌' : '✅';
              const displayIcon = loadingAbsences ? '🔄' : (loadingId === s.id ? '🔄' : icon);

              return (
                <li key={i} className="class-item">
                  <span onClick={() => navigate(`/student/${s.id}`)}>{i + 1} {s.name?.slice(0, 30)}</span>
                  {((user?.role === "coach" && coachesThisClass?.includes(user.id)) || user?.role === "admin") &&
                    <span onClick={() => navigate(`/student/${s.id}`)}>{s.amount}€</span>
                  }
                  <span
                    style={{ cursor: isFuture ? 'not-allowed' : 'pointer' }}
                    onClick={() => !isFuture && toggleAttendance(s.id)}
                  >
                    {displayIcon}
                  </span>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>);
}

export default GroupClassDetailPage;