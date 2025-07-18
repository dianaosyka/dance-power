import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  collection,
  getDocs,
  query,
  doc,
  getDoc,
  setDoc,
  deleteField
} from 'firebase/firestore';
import { useData } from '../context/firebase';
import { useUser } from '../context/UserContext';
import './GroupClassDetailPage.css';

function generateCombinedSchedule(payments, groups, canceled, count) {
  const allPairs = [];

  for (const payment of payments) {
    const [dd, mm, yyyy] = payment.dateFrom.split('.').map(Number);
    let date = new Date(yyyy, mm - 1, dd);


    const localCanceled = {};
    payment.groups.forEach(groupId => {
      localCanceled[groupId] = canceled[groupId] || [];
    });

    while (allPairs.length < count) {
      for (const groupId of payment.groups) {
        const group = groups.find(g => g.id === groupId);
        if (!group || date.getDay() !== group.dayOfWeek) continue;

        const openingDate = new Date(group.openingDate.split('.').reverse().join('-'));
        if (date < openingDate) continue;

        const dateStr = `${String(date.getDate()).padStart(2, '0')}.${String(date.getMonth() + 1).padStart(2, '0')}.${date.getFullYear()}`;
        if (!localCanceled[groupId].includes(dateStr)) {
          allPairs.push({ date: dateStr, groupId, payment });
          if (allPairs.length >= count) break;
        }
      }
      date.setDate(date.getDate() + 1);
    }
  }

  return allPairs;
}

function GroupClassDetailPage() {
  const { groupId, date } = useParams();
  const navigate = useNavigate();
  const { db, groups, payments, students } = useData();
  const { user } = useUser();

  const [group, setGroup] = useState(null);
  const [canceled, setCanceled] = useState({});
  const [signedUp, setSignedUp] = useState([]);
  const [total, setTotal] = useState(0);
  const [absences, setAbsences] = useState({});
  const [loadingId, setLoadingId] = useState(null);
  const [loadingAbsences, setLoadingAbsences] = useState(true);

  useEffect(() => {
    const g = groups.find(g => g.id === groupId);
    setGroup(g);
  }, [groupId, groups]);

  useEffect(() => {
    const fetchCanceled = async () => {
      const map = {};
      for (const group of groups) {
        const q = query(collection(db, `groups/${group.id}/canceledClasses`));
        const snap = await getDocs(q);
        map[group.id] = snap.docs.map(d => d.data().date);
      }
      setCanceled(map);
    };
    fetchCanceled();
  }, [db, groups]);

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

  useEffect(() => {
    if (!group || Object.keys(canceled).length === 0) return;

    const matched = [];

    for (const payment of payments) {
      if (!payment.groups.includes(groupId)) continue;

      const schedule = generateCombinedSchedule([payment], groups, canceled, payment.type);

      for (const { date: d, groupId: gId } of schedule) {
        if (d === date && gId === groupId) {
          const student = students.find(s => s.id === payment.studentId);
          const amount = user?.role === 'coach' ? 1 : payment.amount / payment.type;
          const isAbsent = absences[student?.id]?.[d]?.includes(gId);

          matched.push({
            id: student?.id,
            name: student?.name,
            amount: amount.toFixed(2),
            absent: isAbsent,
          });
        }
      }
    }

    setSignedUp(matched);

    const earned = user?.role === 'coach'
      ? matched.length * 1
      : (matched.reduce((sum, s) => sum + parseFloat(s.amount), 0) - 15);

    setTotal(earned.toFixed(2));
  }, [group, canceled, payments, students, date, groupId, user, absences]);

  const toggleAttendance = async (studentId) => {
    const student = students.find(s => s.id === studentId);
    const confirmMsg = `Are you sure you want to toggle attendance for ${student?.name || 'this student'} on ${date}?`;
    if (!window.confirm(confirmMsg)) return;

    setLoadingId(studentId);

    const ref = doc(db, 'students', studentId);
    const d = date;
    const current = absences[studentId]?.[d] || [];
    const isAbsent = current.includes(groupId);

    let newGroups;
    if (isAbsent) {
      newGroups = current.filter(g => g !== groupId);
    } else {
      newGroups = [...current, groupId];
    }

    const newAbsences = { ...absences };
    try {
      if (newGroups.length === 0) {
        if (newAbsences[studentId]) {
          delete newAbsences[studentId][d];
        }
        await setDoc(ref, {
          absences: {
            [d]: deleteField()
          }
        }, { merge: true });
      } else {
        newAbsences[studentId] = {
          ...newAbsences[studentId],
          [d]: newGroups,
        };
        await setDoc(ref, {
          absences: {
            [d]: newGroups
          }
        }, { merge: true });
      }

      setAbsences(newAbsences);
    } finally {
      setLoadingId(null);
    }
  };

  return (
    <div className="class-detail-page">
      <h2>{group?.name?.toUpperCase()}</h2>
      <p>{date}</p>
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
    </div>
  );
}

export default GroupClassDetailPage;
