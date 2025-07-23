import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  collection,
  getDocs,
  doc,
  getDoc,
  setDoc,
  deleteField
} from 'firebase/firestore';
import { useData } from '../context/firebase';
import { useUser } from '../context/UserContext';
import './GroupClassDetailPage.css';

function parseDate(dateStr) {
  const [dd, mm, yyyy] = dateStr.split('.').map(Number);
  return new Date(yyyy, mm - 1, dd);
}

function formatDate(date) {
  return (
    String(date.getDate()).padStart(2, '0') + '.' +
    String(date.getMonth() + 1).padStart(2, '0') + '.' +
    date.getFullYear()
  );
}

function getNextDates(startFrom, weekday, count, groupId) {
  const result = [];
  const date = new Date(startFrom);
  while (result.length < count) {
    if (date.getDay() === weekday) {
      result.push({ groupId, date: formatDate(new Date(date)) });
    }
    date.setDate(date.getDate() + 1);
  }
  return result;
}

async function getValidClassPairs(payment, allGroups, db) {
  const result = [];
  const startDate = parseDate(payment.dateFrom);

  for (const groupId of payment.groups) {
    const group = allGroups.find(g => g.id === groupId);
    if (!group) {
      console.warn("Missing group:", groupId);
      continue;
    }

    const pastSnap = await getDocs(collection(db, `groups/${groupId}/pastClasses`));
    const validPast = pastSnap.docs
      .map(doc => doc.data())
      .filter(d => d.canceled !== true && parseDate(d.date) >= startDate)
      .sort((a, b) => parseDate(a.date) - parseDate(b.date))
      .map(d => ({ groupId, date: d.date }));

    result.push(...validPast);
  }

  if (result.length < payment.type) {
    const missing = payment.type - result.length;
    const futurePerGroup = Math.ceil(missing / payment.groups.length);
    for (const groupId of payment.groups) {
      const group = allGroups.find(g => g.id === groupId);
      if (!group) continue;
      const future = getNextDates(new Date(), group.dayOfWeek, futurePerGroup, groupId);
      result.push(...future);
      if (result.length >= payment.type) break;
    }
  }

  return result.slice(0, payment.type);
}

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
    const g = groups.find(g => g.id === groupId);
    setGroup(g);
  }, [groupId, groups]);

  useEffect(() => {
    const fetchClassStatus = async () => {
      const ref = doc(db, `groups/${groupId}/pastClasses`, date);
      const snap = await getDoc(ref);
      const data = snap.exists() ? snap.data() : {};
      setIsCanceled(data?.canceled === true);
    };
    fetchClassStatus();
  }, [groupId, date]);

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
    if (!group) return;

    const fetchSignups = async () => {
      const matched = [];

      for (const payment of payments) {
        const pairs = await getValidClassPairs(payment, groups, db);
        const matchedPair = pairs.find(p => p.groupId === groupId && p.date === date);
        if (!matchedPair) continue;

        const student = students.find(s => s.id === payment.studentId);
        const amount = user?.role === 'coach' ? 1 : payment.amount / payment.type;
        const isAbsent = absences[student?.id]?.[date]?.includes(groupId);

        matched.push({
          id: student?.id,
          name: student?.name,
          amount: amount.toFixed(2),
          absent: isAbsent,
        });
      }

      setSignedUp(matched);

      const earned = user?.role === 'coach'
        ? matched.length * 1
        : (matched.reduce((sum, s) => sum + parseFloat(s.amount), 0) - 15);

      setTotal(earned.toFixed(2));
    };

    fetchSignups();
  }, [group, payments, students, date, groupId, user, absences]);

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

  return (
    <div className="class-detail-page">
      <h2>{group?.name?.toUpperCase()}</h2>
      <p>{date}</p>
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
