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
  const { db, groups, payments, students } = useData();
  const { user } = useUser();

  const [group, setGroup] = useState(null);
  const [signedUp, setSignedUp] = useState([]);
  const [total, setTotal] = useState(0);
  const [absences, setAbsences] = useState({});
  const [loadingId, setLoadingId] = useState(null);
  const [loadingAbsences, setLoadingAbsences] = useState(true);
  const [isCanceled, setIsCanceled] = useState(false);

  useEffect(() => {
    setGroup(groups.find(g => g.id === groupId));
  }, [groupId, groups]);

  useEffect(() => {
    const fetchClassStatus = async () => {
      const ref = doc(db, `groups/${groupId}/pastClasses`, date);
      const snap = await getDoc(ref);
      const data = snap.exists() ? snap.data() : {};
      setIsCanceled(data?.canceled === true);
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

  // MAIN LOGIC: show students signed up for this group/date, by scanning ALL payments
  useEffect(() => {
    if (!group || !payments?.length || !students?.length) return;

    const fetchSignups = async () => {
      // Build signups by payments
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

      // Your original total calculation logic
      const earned = user?.role === 'coach'
        ? matched.length * 1
        : (matched.reduce((sum, s) => sum + parseFloat(s.amount), 0) - 15);

      setTotal(earned.toFixed(2));
    };

    fetchSignups();
    // NOTE: absences affects the ✅/❌ icon; include it so UI updates when toggling
  }, [group, groupId, date, payments, students, absences, user, db, groups]);


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

  return (
    <div className="class-detail-page">
      <h2>{group?.name?.toUpperCase()}</h2>
      <p>{date}</p>
      {user?.role === 'admin' && (
        <button onClick={handleDeleteClass} style={{ backgroundColor: 'red', color: 'white' }}>
          🗑 DELETE CLASS
        </button>
      )}
      {isCanceled ? (
        <h3 style={{ color: 'red' }}>🚫 CLASS CANCELED</h3>
      ) : (
        <>
          <h3>EARNED:</h3>
          <h1 style={{ fontSize: '36px' }}>{total}€</h1>

          <h3>PEOPLE</h3>
          <div className="classes-header">
            <span>PERSON</span>
            <span>MONEY</span>
            <span>ATTENDED</span>
          </div>

          <ul className="student-list">
            {signedUp.map((s, i) => {
              const today = new Date();
              const [dd, mm, yyyy] = date.split('.').map(Number);
              const classDate = new Date(yyyy, mm - 1, dd);
              const isFuture = classDate > today;
              const icon = isFuture ? '🕒' : s.absent ? '❌' : '✅';
              const displayIcon = loadingAbsences ? '🔄' : (loadingId === s.id ? '🔄' : icon);

              return (
                <li key={i} className="class-item">
                  <span onClick={() => navigate(`/student/${s.id}`)}>{i + 1} {s.name?.slice(0, 30)}</span>
                  <span onClick={() => navigate(`/student/${s.id}`)}>{s.amount}€</span>
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
    </div>
  );
}

export default GroupClassDetailPage;
